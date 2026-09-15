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
// These arms compose the services' file the way start does — start's own tables, a COPY of its carry loop
// (`carried` below: start runs those four lines inline, so there is no function to call), and its add-only
// merge — and then ask the run door's own resolver about ONLY what the file holds. A composer checked against
// the environment it was composed from passes on exactly the machine that fails. Where start's guard and its
// write are concerned, the arms call start's own reading, `unitsFileAfterStart`, and not a copy.
//
// BREAK MATRIX:
//   · two clouds, a switch beside subscription, api-key   → break: drop the run door's refusal from the
//     with no key: refused at order time, door's words      billing row, or the key row, red
//   · the key and the long-lived sign-in travel           → break: drop either row, red
//   · a switch set and not on is not carried, and said    → break: carry it through the alternatives or the
//                                                           other settings, or drop the sentence, red
//   · start's guard reads the file its merge leaves, and  → break: let start's value win in the reading, or
//     names what the file keeps from another config        name nothing, red
//   · doctor says how the services pay when it differs    → break: drop the second billing line, red
//   · each cloud and the gateway reach the services      → break: drop the cloud rows, the per-cloud arms go red
//   · a stray switch under subscription stays behind     → break: gate the rows on a switch, not the word, red
//   · Codex's list does not change                       → break: drop the engine's pay-ways gate, red
//   · a missing switch is refused at order time, named   → break: drop the unnamed-cloud row, red
//   · every row is one setting, and carried              → break: name the row by all four, red
//   · doctor reads a switch the services hold            → break: doctor's fill back to two passes, or read
//                                                           only the row's name and not its alternatives, red
//   · no secret value is printed                          → break: put a value into a row's reason, red
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runRequirements, runRequiredNames, missingRequirements, orderTimeRefusal, ORDER } from "../run-requirements.mjs";
import { resolveAuthMode, CLOUD_SWITCH, CLOUD_SETTINGS } from "../engine/auth.mjs";
import { parseEnvFile } from "../../shared/env-file-merge.mjs";
import { runTables, homeEnvUpdate, unitsFileAfterStart, BACKGROUND_UNITS } from "../../bin/start.mjs";
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
  const { text } = homeEnvUpdate(existing, carried(supervisor));
  return { text, env: parseEnvFile(text) };
}

/** What start's carry loop takes from `supervisor`: a copy of the loop in `bin/start.mjs` over the one authority. */
function carried(supervisor) {
  const union = {};
  for (const name of runRequiredNames(supervisor, T)) {
    const v = String(supervisor[name] ?? "").trim();
    if (v && union[name] === undefined) union[name] = v;
  }
  return union;
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
  // ONE REAL SETTING AS THE NAME, because every reader prints or logs it as a variable; the four in the reason.
  assert.ok(row.anyOf.includes(row.name), `the row is named by something that is not a setting: ${row.name}`);
  for (const n of row.anyOf) assert.ok(row.why.includes(n), `the reason does not name ${n}`);
  assert.match(row.why, /CLAUDE_CODE_USE_VERTEX=1 for Google Cloud.*CLAUDE_CODE_USE_FOUNDRY=1 for Microsoft Azure.*CLAUDE_CODE_USE_BEDROCK=1 for Amazon Bedrock/,
    "the reason does not say which switch is whose");
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

test("under a cloud billing word every row is named by one setting, and every one of them is carried", () => {
  // The identity the composer and the guard share, driven where the cloud rows exist: a row checked and not
  // carried is a refusal nobody can satisfy, and a name that is not a setting reads as several in a list.
  const states = { "no switch": {}, ...CLOUDS };
  for (const [state, settings] of Object.entries(states)) {
    const env = { ...BASE, CLEAROTRON_AI_BILLING: "cloud", ...settings };
    const carried = new Set(runRequiredNames(env, T));
    for (const r of runRequirements(env, T)) {
      assert.match(r.name, /^[A-Z][A-Z0-9_]*$/, `${state}: a row is named by something that is not a setting: ${r.name}`);
      assert.ok(carried.has(r.name), `${state}: ${r.name} is checked and not carried`);
    }
  }
});

test("no secret's value appears in a row or a refusal", () => {
  // Start prints a row as `${r.name} — ${r.why}`, and this rebuilds that line rather than driving start, so it
  // holds while start keeps that shape. Google's settings hold no secret (its key is a file, named by path),
  // so there is nothing of it to leak.
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

// ── WHAT THE RUN DOOR REFUSES THAT IS SET, NOT MISSING ─────────────────────────────────────────────
//
// The rows named what was missing and nothing else, so a services' file the run door refuses for what it
// holds (two clouds switched on, a switch beside subscription, api-key with no key) passed start's guard,
// the order wall and doctor, and every search was refused after intake. Measured 2026-09-15; the first of
// them is what a start with Google's cloud leaves in a file written by a start with Microsoft's.

const doorSays = (env) => { try { resolveAuthMode({ engineName: "anthropic-agent", env }); return null; } catch (e) { return e.message; } };

test("a services' file the run door refuses for what it holds is refused at order time, in the door's own words", () => {
  for (const [label, file, name, door] of [
    ["two clouds", { ...BASE, CLEAROTRON_AI_BILLING: "cloud", CLAUDE_CODE_USE_FOUNDRY: "1", CLAUDE_CODE_USE_VERTEX: "1" }, "CLEAROTRON_AI_BILLING", /more than one cloud is switched on/],
    ["a switch beside subscription", { ...BASE, CLEAROTRON_AI_BILLING: "subscription", CLAUDE_CODE_USE_FOUNDRY: "1" }, "CLEAROTRON_AI_BILLING", /CLAUDE_CODE_USE_FOUNDRY is on/],
    ["api-key with no key", { ...BASE, CLEAROTRON_AI_BILLING: "api-key" }, "ANTHROPIC_API_KEY", /ANTHROPIC_API_KEY is not set/],
    ["a word that is no billing mode", { ...BASE, CLEAROTRON_AI_BILLING: "metered" }, "CLEAROTRON_AI_BILLING", /is not a billing mode/],
  ]) {
    // THE FLOOR: the run door refuses this file, so a refusal here is the door's and not a stricter opinion.
    assert.match(doorSays(file) ?? "(the run door accepts it)", door, label);
    const miss = missingRequirements(file, T);
    assert.deepEqual(miss.atStart.map((r) => r.name), [], `${label}: refused a start — an operator's value never bricks an install`);
    assert.deepEqual(miss.atOrder.map((r) => r.name), [name], `${label}: the order wall does not name ${name}`);
    const r = orderTimeRefusal(file, T, { envFile: "/srv/example/.env" });
    assert.ok(r?.operator.includes(name), `${label}: the order-time refusal does not name ${name}`);
    if (name === "CLEAROTRON_AI_BILLING") assert.ok(miss.atOrder[0].why.includes(doorSays(file)), `${label}: the reason is not the run door's own words`);
    assert.doesNotMatch(r.client, /[A-Z][A-Z0-9]*_[A-Z0-9_]+/, `${label}: a variable name reached the client`);
  }
  // CONTROL: each word with what it needs, and one cloud, is refused nowhere.
  for (const file of [{ ...BASE, CLEAROTRON_AI_BILLING: "subscription" }, { ...BASE, CLEAROTRON_AI_BILLING: "api-key", ANTHROPIC_API_KEY: SECRET },
    { ...BASE, CLEAROTRON_AI_BILLING: "cloud", CLAUDE_CODE_USE_FOUNDRY: "1" }]) {
    assert.equal(doorSays(file), null);
    assert.deepEqual(missingRequirements(file, T).atOrder.map((r) => r.name), [], file.CLEAROTRON_AI_BILLING);
  }
  // AND NO NAME JOINS THE LIST TO CARRY: a switch beside subscription still stays out of the services' file.
  assert.equal(servicesFile({ ...BASE, CLEAROTRON_AI_BILLING: "subscription", CLAUDE_CODE_USE_FOUNDRY: "1" }).env.CLAUDE_CODE_USE_FOUNDRY, undefined);
});

test("an api-key machine hands the services its key, and a subscription machine its long-lived sign-in", () => {
  const apiKey = { ...BASE, CLEAROTRON_AI_BILLING: "api-key", ANTHROPIC_API_KEY: SECRET };
  const { env } = servicesFile(apiKey);
  assert.equal(env.ANTHROPIC_API_KEY, SECRET, "the key did not reach the services' file");
  assert.equal(doorSays(env), null, "the services' file of an api-key machine refuses at the run door");
  const codex = { ...BASE, CLEAROTRON_AI: "openai-agent", [CODEX.env]: "/usr/bin/true", CLEAROTRON_AI_BILLING: "api-key", [CODEX.apiKeyEnv]: SECRET };
  assert.equal(servicesFile(codex).env[CODEX.apiKeyEnv], SECRET, "Codex's key did not reach the services' file");
  const token = T.engines["anthropic-agent"].headless.tokenEnv;
  const signedIn = { ...BASE, CLEAROTRON_AI_BILLING: "subscription", [token]: SECRET };
  assert.equal(servicesFile(signedIn).env[token], SECRET, `${token} did not reach the services' file`);
  assert.equal(runRequirements(signedIn, T).find((r) => r.name === token).blocking, false, "a sign-in the program can hold itself was made a requirement");
  // CONTROL: a key the subscription strips from every turn does not travel, and nothing is asked of a subscription.
  assert.equal(servicesFile({ ...BASE, CLEAROTRON_AI_BILLING: "subscription", ANTHROPIC_API_KEY: SECRET }).env.ANTHROPIC_API_KEY, undefined);
  assert.deepEqual(missingRequirements({ ...BASE, CLEAROTRON_AI_BILLING: "subscription" }, T).blocking.map((r) => r.name), []);
});

test("a cloud switch that is set and not on is neither carried nor passed over in silence", () => {
  const supervisor = { ...BASE, CLEAROTRON_AI_BILLING: "cloud", CLAUDE_CODE_USE_FOUNDRY: "0", ANTHROPIC_FOUNDRY_RESOURCE: "example-resource" };
  // THE FLOOR: the run door reads the switch as off.
  assert.match(doorSays(supervisor) ?? "", /none of CLAUDE_CODE_USE_VERTEX/);
  const { env } = servicesFile(supervisor);
  assert.equal(env.CLAUDE_CODE_USE_FOUNDRY, undefined, "a switch that is off was written into the services' file, where it keeps a later =1 out");
  assert.equal(env.ANTHROPIC_FOUNDRY_RESOURCE, "example-resource", "the settings beside it stopped travelling");
  const row = missingRequirements(supervisor, T).atOrder.find((r) => r.anyOf);
  assert.ok(row, "the missing switch is no longer refused at order time");
  assert.match(row.why, /CLAUDE_CODE_USE_FOUNDRY is set, but not on/, "the reason does not say the switch that is set is not on");
  const names = runRequiredNames(supervisor, T);
  assert.equal(new Set(names).size, names.length, `a name is handed out twice: ${names.join(", ")}`);
});

// ── START, ACROSS TWO STARTS ───────────────────────────────────────────────────────────────────────
//
// Start's merge never replaces a line in the services' file. Its guard read `{ ...file, ...start }`, where
// start's value wins, so it passed files the units then read differently; and a second start after moving to
// another cloud, or after rotating a key, reported the file complete while the services kept the old values.

test("start's guard reads the file its merge leaves, and names every run setting that file keeps from another configuration", () => {
  const after = (existing, supervisor) => unitsFileAfterStart(existing, carried(supervisor), { config: supervisor, tables: T });
  const cloud = (c) => ({ ...BASE, CLEAROTRON_AI_BILLING: "cloud", ...CLOUDS[c] });
  const first = (supervisor) => servicesFile(supervisor).text;

  // AN EMPTY LINE KEPT: start holds the switch, the file keeps its empty line, and the units have no cloud.
  const empty = after("CLAUDE_CODE_USE_FOUNDRY=\n", cloud("foundry"));
  assert.equal(empty.reads.CLAUDE_CODE_USE_FOUNDRY, "", "the reading is not what the file says");
  assert.match(doorSays(empty.reads) ?? "", /none of CLAUDE_CODE_USE_VERTEX/, "the floor: the units' file refuses at the run door");
  assert.ok(missingRequirements(empty.reads, T).atOrder.some((r) => r.anyOf), "start's guard passed a file the run door refuses");
  assert.ok(empty.differ.includes("CLAUDE_CODE_USE_FOUNDRY"), `the kept empty line is not named: ${empty.differ}`);

  // MICROSOFT, THEN GOOGLE: both switches end up in the file, and the guard now sees it.
  const twice = after(first(cloud("foundry")), cloud("vertex"));
  assert.equal(twice.reads.CLAUDE_CODE_USE_FOUNDRY, "1");
  assert.deepEqual(missingRequirements(twice.reads, T).atOrder.map((r) => r.name), ["CLEAROTRON_AI_BILLING"]);
  assert.ok(twice.differ.includes("CLAUDE_CODE_USE_FOUNDRY"), `Microsoft's switch, kept by the file, is not named: ${twice.differ}`);

  // MICROSOFT, THEN A GATEWAY, AND MICROSOFT, THEN THE SUBSCRIPTION: the run door accepts the file, and it
  // bills Microsoft. Nothing refuses, so saying it is the whole of the protection.
  const gateway = after(first(cloud("foundry")), cloud("gateway"));
  assert.equal(resolveAuthMode({ engineName: "anthropic-agent", env: gateway.reads }).cloud, "foundry", "the floor: the services still bill Microsoft");
  assert.ok(gateway.differ.includes("CLAUDE_CODE_USE_FOUNDRY"), `a gateway machine billing Microsoft is not told: ${gateway.differ}`);
  const subscription = after(first(cloud("foundry")), { ...BASE, CLEAROTRON_AI_BILLING: "subscription" });
  for (const n of ["CLEAROTRON_AI_BILLING", "CLAUDE_CODE_USE_FOUNDRY"])
    assert.ok(subscription.differ.includes(n), `a subscription machine billing Microsoft is not told about ${n}: ${subscription.differ}`);

  // A ROTATED KEY: the file keeps the first value, and says which.
  const rotated = { ...cloud("bedrock"), AWS_ACCESS_KEY_ID: "rotated", AWS_SECRET_ACCESS_KEY: "rotated", AWS_SESSION_TOKEN: "rotated" };
  const rot = after(first(cloud("bedrock")), rotated);
  assert.equal(rot.reads.AWS_SESSION_TOKEN, SECRET, "the floor: the file kept the first value");
  assert.deepEqual(rot.differ, ["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN"]);

  // CONTROL: the same configuration started twice differs on nothing and refuses nothing.
  for (const c of Object.keys(CLOUDS)) {
    const again = after(first(cloud(c)), cloud(c));
    assert.deepEqual([again.differ, missingRequirements(again.reads, T).atOrder.map((r) => r.name)], [[], []], c);
  }
  // CONTROL: A HEALTHY INSTALL WHOSE SETTINGS LIVE IN THE UNITS' FILE. Start is told to send an operator to that
  // file, so a start from a shell holding only the pool, the engine and how it pays sees the register key, the
  // program's path and the research key there alone. None of that is a disagreement, and a switch written `true`
  // here and `1` there is the same switch.
  const bare = { CLEAROTRON_REPORTS_DIR: BASE.CLEAROTRON_REPORTS_DIR, CLEAROTRON_AI: BASE.CLEAROTRON_AI };
  for (const [label, file, config] of [
    ["subscription", first({ ...BASE, CLEAROTRON_AI_BILLING: "subscription" }), bare],
    ["Microsoft", first(cloud("foundry")), { ...bare, CLEAROTRON_AI_BILLING: "cloud", CLAUDE_CODE_USE_FOUNDRY: "true" }],
  ]) {
    const healthy = after(file, config);
    assert.equal(healthy.reads[REG.credentials[0]], "fixture-credential", `${label}: the floor: the file holds what the shell does not`);
    assert.deepEqual(healthy.differ, [], `${label}: a working install is warned about its own settings`);
  }
  // NAMES ONLY: what start prints is this list, and it carries no value.
  for (const f of [empty, twice, gateway, subscription, rot]) for (const n of f.differ) assert.match(n, /^[A-Z][A-Z0-9_]*$/);
  // AND START PRINTS IT. Read from its source, as the wiring arms in the background-install file read it.
  const src = readFileSync(join(REPO, "bin", "start.mjs"), "utf8");
  assert.match(src, /if \(unitsFile\.differ\.length\) \{\n\s*say\(/, "start no longer says which settings the file keeps");
  assert.match(src, /say\(`\s+\$\{unitsFile\.differ\.join\(", "\)\}`\)/, "start no longer names them");
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
    assert.match(willRun(a), /a search is refused until this is set in the units' environment: CLAUDE_CODE_USE_VERTEX\s*$/m,
      `the missing switch was not reported:\n${willRun(a)}`);
    assert.match(willRun(a), /CLAUDE_CODE_USE_FOUNDRY=1 for Microsoft Azure/, "the reason under it does not name the other clouds' switches");
    const b = doctor(holding);
    assert.match(willRun(b), /nothing a search is refused for at order time is missing from the units' environment/,
      `a switch the services hold was reported missing:\n${willRun(b)}`);
    // AND ITS BILLING LINE SAYS HOW THE SERVICES PAY. Doctor's shell holds nothing, so its own reading is the
    // subscription; the services pay Microsoft, and doctor printed only the first.
    assert.match(b, /billing: subscription/, "the floor: doctor's own configuration reads as the subscription");
    assert.match(b, /the services read how they pay from the units' environment, and it says otherwise — billing: cloud — charged per use to your Microsoft Azure account \(Foundry\)/,
      `doctor does not say how the services pay:\n${b.replaceAll(SECRET, "…")}`);
    for (const out of [a, b]) assert.ok(!out.includes(SECRET), "doctor printed a secret's value");
  } finally { for (const h of [lacking, holding]) rmSync(h, { recursive: true, force: true }); }
});

test("doctor reports services that hold two clouds, which the run door refuses after intake", () => {
  const home = unitsHome({ ...UNITS_BASE, CLEAROTRON_AI_BILLING: "cloud", ...CLOUDS.foundry, CLAUDE_CODE_USE_VERTEX: "1" });
  try {
    const out = doctor(home);
    assert.match(willRun(out), /the units' environment/, `the fixture did not reach the hosted path:\n${out.replaceAll(SECRET, "…")}`);
    assert.match(willRun(out), /a search is refused until this is set in the units' environment: CLEAROTRON_AI_BILLING\s*$/m,
      `two clouds in the services' file were not reported:\n${willRun(out).replaceAll(SECRET, "…")}`);
    assert.match(willRun(out), /more than one cloud is switched on \(CLAUDE_CODE_USE_VERTEX, CLAUDE_CODE_USE_FOUNDRY\)/, "the reason is not the run door's");
    assert.ok(!out.includes(SECRET), "doctor printed a secret's value");
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test("THE CONTROL: a subscription machine's doctor verdict is unchanged", () => {
  const home = unitsHome({ ...UNITS_BASE, CLEAROTRON_AI_BILLING: "subscription" });
  try {
    assert.match(willRun(doctor(home)), /nothing a search is refused for at order time is missing from the units' environment/);
  } finally { rmSync(home, { recursive: true, force: true }); }
});
