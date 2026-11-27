// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// WEB RESEARCH IS ONE SETTING, READ IN ONE PLACE (web-research.mjs).
//
// The installation names its service; an installation that names none has chosen none, and nothing chooses for it: a
// clearance that needs the web half is refused with what to set, and a Knockout runs its register half. What each
// service can run here is decided from the engine and its billing route, never from which keys are present, and the
// check places no search. The run door and the run's record read the same answers.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installWebResearch, notChosenRefusal, refuseUnchosenResearch, researchDoor, webResearchCapability, OWN_SEARCH_STILL_PERPLEXITY, WEB_RESEARCH_SETTING, WEB_RESEARCH_SERVICES } from "../web-research.mjs";
import { preflightResearchCredential } from "../driver.config.mjs";
import { policyFor } from "../search-policy.mjs";
import { readRunChoices, recordRunChoices, researchForRun, researchNotChosen, RunChoiceUnavailable } from "../engine/run-choices.mjs";
import { driverDir } from "../../shared/driver-dir.mjs";

test("the setting names one of two services; unset chooses none; anything else is no service", () => {
  assert.deepEqual(WEB_RESEARCH_SERVICES, ["own", "perplexity"]);
  assert.deepEqual(installWebResearch({}), { service: null, chosen: false, unset: true });
  assert.deepEqual(installWebResearch({ [WEB_RESEARCH_SETTING]: "  " }), { service: null, chosen: false, unset: true });
  assert.deepEqual(installWebResearch({ [WEB_RESEARCH_SETTING]: " Own " }), { service: "own", chosen: true });
  assert.deepEqual(installWebResearch({ [WEB_RESEARCH_SETTING]: "perplexity" }), { service: "perplexity", chosen: true });
  assert.deepEqual(installWebResearch({ [WEB_RESEARCH_SETTING]: "google" }), { service: null, chosen: true, invalid: "google" });
});

test("a key is never what decides the service", () => {
  assert.deepEqual(installWebResearch({ PERPLEXITY_API_KEY: "k" }), { service: null, chosen: false, unset: true }, "a key present is not a choice");
  assert.equal(installWebResearch({ [WEB_RESEARCH_SETTING]: "own", PERPLEXITY_API_KEY: "k" }).service, "own", "a key present does not override the choice");
});

test("own search follows the engine's route; Perplexity needs its key; the check names settings, never values", () => {
  const cases = [
    [{ service: "own" }, true],
    [{ service: "own", env: { CLEAROTRON_AI_BILLING: "api-key", ANTHROPIC_API_KEY: "secret-value" } }, true],
    [{ service: "own", engine: "openai-agent" }, true],
    [{ service: "own", engine: "openai-agent", env: { CLEAROTRON_AI_BILLING: "api-key", CODEX_API_KEY: "secret-value" } }, true],
    [{ service: "own", env: { CLEAROTRON_AI_BILLING: "cloud", CLAUDE_CODE_USE_BEDROCK: "1" } }, false, /Amazon Bedrock has no web search/],
    [{ service: "own", env: { CLEAROTRON_AI_BILLING: "cloud", CLAUDE_CODE_USE_VERTEX: "1" } }, false, /not proved through Google Vertex/],
    [{ service: "own", env: { CLEAROTRON_AI_BILLING: "cloud", CLAUDE_CODE_USE_FOUNDRY: "1" } }, false, /not proved through Microsoft Foundry/],
    [{ service: "own", env: { CLEAROTRON_AI_BILLING: "cloud", ANTHROPIC_BASE_URL: "https://gw.example" } }, false, /not proved through a gateway/],
    [{ service: "own", engine: "probe-retired" }, false, /has no web search of its own/],
    [{ service: "own", env: { CLEAROTRON_AI_BILLING: "api-key" } }, false, /billing setting is refused/],
    [{ service: "perplexity", env: {} }, false, /PERPLEXITY_API_KEY is not set/],
    [{ service: "perplexity", env: { PERPLEXITY_API_KEY: "secret-value" } }, true],
    [{ service: "google" }, false, /names no service/],
  ];
  // A key held beside own search changes nothing: the next test shows own search passing without one.
  const KEY = { PERPLEXITY_API_KEY: "secret-value" };
  for (const [args, ok, why] of cases) {
    const r = webResearchCapability({ ...args, env: { ...(args.service === "own" ? KEY : {}), ...(args.env ?? {}) } });
    assert.equal(r.ok, ok, JSON.stringify(args));
    if (why) assert.match(r.why, why, JSON.stringify(args));
    assert.ok(!JSON.stringify(r).includes("secret-value"), "a value reached the answer");
  }
  assert.deepEqual(webResearchCapability({ service: "perplexity", env: {} }).missing, ["PERPLEXITY_API_KEY"]);
});

test("own search needs no Perplexity key; a part it did not run would need it, and the check would say which", () => {
  assert.deepEqual([...OWN_SEARCH_STILL_PERPLEXITY], [], "own search runs every part of a clearance's web research");
  assert.equal(webResearchCapability({ service: "own", env: {} }).ok, true, "no key, and own search runs");
  const r = webResearchCapability({ service: "own", env: {}, stillPerplexity: ["a part"] });
  assert.equal(r.ok, false);
  assert.deepEqual(r.missing, ["PERPLEXITY_API_KEY"]);
  assert.match(r.why, /still sends its a part to Perplexity/);
  assert.match(webResearchCapability({ service: "own", env: { CLEAROTRON_AI_BILLING: "cloud", CLAUDE_CODE_USE_BEDROCK: "1" }, stillPerplexity: ["a part"] }).why, /Amazon Bedrock/,
    "a route with no search is named first: a key would not make it run");
});

test("the door checks the run's service, and the service handed in wins over the setting", () => {
  const p = policyFor("full-country-search");
  const KEY = { PERPLEXITY_API_KEY: "k" };
  assert.equal(researchDoor(p, { [WEB_RESEARCH_SETTING]: "own", ...KEY }).service, "own");
  assert.equal(researchDoor(p, { [WEB_RESEARCH_SETTING]: "own" }).service, "own", "own search needs no key");
  assert.throws(() => researchDoor(p, { [WEB_RESEARCH_SETTING]: "own", ...KEY, CLEAROTRON_AI: "openai-agent" }, { engine: "probe-retired" }), /probe-retired engine has no web search/,
    "the door judges the engine the run uses, not the one the environment names");
  assert.throws(() => researchDoor(p, { [WEB_RESEARCH_SETTING]: "own" }, { service: "perplexity" }), /missing PERPLEXITY_API_KEY/,
    "a run recorded on Perplexity is checked there, whatever the installation now says");
  assert.equal(researchDoor(p, { PERPLEXITY_API_KEY: "k" }, { service: "own" }).service, "own");
  assert.throws(() => researchDoor(p, { [WEB_RESEARCH_SETTING]: "own", CLEAROTRON_AI_BILLING: "cloud", CLAUDE_CODE_USE_BEDROCK: "1" }),
    /own web search cannot run here .*Amazon Bedrock/);
  assert.throws(() => researchDoor(p, { [WEB_RESEARCH_SETTING]: "google" }), /names no web-research service/);
  assert.equal(researchDoor(policyFor("knockout-search"), { [WEB_RESEARCH_SETTING]: "own", CLEAROTRON_AI_BILLING: "cloud", CLAUDE_CODE_USE_BEDROCK: "1" }).checked, false,
    "a Knockout is never refused at this door");
});

test("an installation that names no service is refused a clearance by name, with what to set; a Knockout runs without one", () => {
  const KEY = { PERPLEXITY_API_KEY: "k" };
  for (const product of ["global-preliminary-search", "multi-country-focus-search", "full-country-search"]) {
    assert.throws(() => researchDoor(policyFor(product), KEY),
      { message: "[preflight] Choose a web research service before starting this clearance. Run npx clearotron install." }, `${product}: a key present chose nothing`);
    assert.throws(() => researchDoor(policyFor(product), KEY, { service: null }), /Choose a web research service/, "a run recorded with none is refused too");
  }
  assert.equal(notChosenRefusal(), "[preflight] Choose a web research service before starting this clearance. Run npx clearotron install.");
  assert.doesNotMatch(notChosenRefusal(), /PERPLEXITY_API_KEY/, "a key is not the choice, so the refusal never sends the reader to one");
  assert.equal(researchDoor(null, KEY).deferred, true, "an order whose product its profile settles is asked again once it is known");
  assert.throws(() => refuseUnchosenResearch(policyFor("full-country-search")), /Choose a web research service/, "a clearance its profile settled is refused");
  assert.equal(refuseUnchosenResearch(policyFor("knockout-search")), undefined, "a Knockout its profile settled runs its register half");
  assert.deepEqual(researchDoor(policyFor("knockout-search"), KEY),
    { checked: false, component: "commonLawGrid", service: null, credEnv: null, missing: [] });
  assert.throws(() => researchDoor(policyFor("knockout-search"), { [WEB_RESEARCH_SETTING]: "google" }), /names no web-research service/,
    "a setting that names no service is a fault every run is refused over, a Knockout's included");
});

test("the configuration's door never reads the setting: it checks the service it is handed, Perplexity when none is", () => {
  const p = policyFor("full-country-search");
  assert.throws(() => preflightResearchCredential(p, { [WEB_RESEARCH_SETTING]: "own" }), /missing PERPLEXITY_API_KEY/);
  assert.throws(() => preflightResearchCredential(p, {}, { service: "own" }), /nothing checked whether this installation can run it/,
    "own search with no capability check is never let through");
  assert.equal(preflightResearchCredential(p, {}, { service: "own", own: { ok: true } }).service, "own");
  assert.throws(() => preflightResearchCredential(p, {}, { service: "google" }), /not a web-research service/);
});

test("the run's record holds its service or that none was chosen, and a run recorded before the service keeps Perplexity", () => {
  const runDir = mkdtempSync(join(tmpdir(), "web-research-record-"));
  try {
    assert.equal(researchForRun(runDir), null, "no record, no service: the caller meets the installation's setting");
    assert.throws(() => recordRunChoices(runDir, { engine: "anthropic-agent", register: null, research: "google" }), /not a web-research service/);
    recordRunChoices(runDir, { engine: "anthropic-agent", register: null, research: "own" });
    assert.equal(readRunChoices(runDir).research, "own");
    assert.equal(researchForRun(runDir), "own");
    assert.equal(recordRunChoices(runDir, { engine: "anthropic-agent", register: null, research: "perplexity" }).written, false, "the record is never rewritten");
    writeFileSync(driverDir(runDir, "run-choices.json"), JSON.stringify({ schema: 1, engine: "anthropic-agent", register: null }));
    assert.equal(researchForRun(runDir), "perplexity");
    writeFileSync(driverDir(runDir, "run-choices.json"), JSON.stringify({ schema: 1, engine: "anthropic-agent", register: null, research: "google" }));
    assert.equal(readRunChoices(runDir).state, "unreadable", "a service this driver does not know is never read as either service");
    rmSync(driverDir(runDir, "run-choices.json"));
    assert.equal(recordRunChoices(runDir, { engine: "anthropic-agent", register: null, research: null }).research, null);
    const rec = readRunChoices(runDir);
    assert.ok(Object.hasOwn(rec, "research") && rec.research === null, "none chosen reads back as none, not as a record from before the service");
    assert.equal(researchForRun(runDir), null);
    assert.equal(researchNotChosen(runDir), true);
    rmSync(driverDir(runDir, "run-choices.json"));
    recordRunChoices(runDir, { engine: "anthropic-agent", register: null });
    assert.equal(Object.hasOwn(readRunChoices(runDir), "research"), false, "a caller that names no service records nothing about it");
    assert.equal(researchNotChosen(runDir), false);
  } finally { rmSync(runDir, { recursive: true, force: true }); }
});

test("a run whose service this runner cannot serve parks under its own kind", () => {
  const e = new RunChoiceUnavailable({ kind: "research", recorded: "own", machine: "perplexity", detail: "no web search", run: { codename: "probe" } });
  assert.deepEqual(e.dependency, { kind: "research", recorded: "own", machine: "perplexity", detail: "no web search" });
  assert.match(e.message, /started on the AI program's own web search, and this runner cannot serve it/);
  assert.match(new RunChoiceUnavailable({ kind: "research", recorded: "perplexity", run: null }).message, /started on the perplexity web research/);
});

test("on own search, each product's questions take the route its sign-in's catalog allows, and Full country stops before spending otherwise", async () => {
  const { ownSearchRoute, ROUTE_WORDS } = await import("../web-research.mjs");
  const { catalogFrom, readCodexCatalog } = await import("../engine/codex-catalog.mjs");
  // The catalog's shape as `codex debug models` renders it (measured 2026-11-27), model ids only.
  const catalog = catalogFrom(JSON.stringify({ models: [{ slug: "gpt-6.1-terra" }, { slug: "gpt-6.1-sol" }, { slug: "gpt-6-luna" }] }));
  assert.deepEqual([...catalog], ["gpt-6.1-terra", "gpt-6.1-sol", "gpt-6-luna"]);
  const full = policyFor("full-country-search"), codex = "openai-agent";
  const FALLBACK = { CLEAROTRON_WEB_RESEARCH_FALLBACK: "perplexity", PERPLEXITY_API_KEY: "k" };
  assert.deepEqual(ownSearchRoute({ policy: full, engine: codex, catalog, env: {} }),
    { stop: "missing", model: "gpt-6.2-sol", detail: "CLEAROTRON_WEB_RESEARCH_FALLBACK=perplexity, with PERPLEXITY_API_KEY",
      why: `[preflight] ${ROUTE_WORDS.fullCountryMissing} (CLEAROTRON_WEB_RESEARCH_FALLBACK=perplexity, with PERPLEXITY_API_KEY)` });
  assert.equal(ROUTE_WORDS.fullCountryMissing, "This Codex sign-in lacks the model needed for Full country. Configure the Perplexity fallback or choose a supported AI setup.");
  assert.deepEqual(ownSearchRoute({ policy: full, engine: codex, catalog, env: FALLBACK }),
    { route: "perplexity", model: "gpt-6.2-sol", disclosure: "Perplexity will handle any questions that need the deepest research level." });
  assert.equal(ownSearchRoute({ policy: full, engine: codex, catalog, env: { CLEAROTRON_WEB_RESEARCH_FALLBACK: "perplexity" } }).stop, "missing", "a fallback with no key is no fallback");
  assert.deepEqual(ownSearchRoute({ policy: full, engine: codex, catalog: null, env: FALLBACK }),
    { stop: "unknown", model: "gpt-6.2-sol", detail: null, why: "[preflight] Clearotron could not check whether this Codex sign-in supports Full country. Check the sign-in and try again." },
    "a catalog that cannot be read is not known: never proof the model is missing, nor authority to buy the fallback");
  assert.deepEqual(ownSearchRoute({ policy: { level: "full-country-search" }, engine: codex, catalog: new Set(["gpt-6.2-sol"]), env: {} }), { route: "own" }, "the run's frozen policy names its product `level`");
  for (const product of ["knockout-search", "global-preliminary-search", "multi-country-focus-search"]) {
    assert.deepEqual(ownSearchRoute({ policy: policyFor(product), engine: codex, catalog, env: {} }), { route: "own" }, `${product}: its model is offered`);
    assert.deepEqual(ownSearchRoute({ policy: policyFor(product), engine: codex, catalog: null, env: {} }), { route: "own" }, `${product}: not known runs, and fails with the program's reason if it must`);
  }
  assert.match(ownSearchRoute({ policy: policyFor("multi-country-focus-search"), engine: codex, catalog: new Set(["gpt-6-luna"]), env: FALLBACK }).why,
    /need gpt-6\.1-sol, which this Codex sign-in does not offer/, "the fallback is Full country's alone");
  assert.deepEqual(ownSearchRoute({ policy: full, engine: "anthropic-agent", catalog: null, env: {} }), { route: "own" }, "Claude's catalog is not read here");
  for (const text of ["not json", JSON.stringify({ models: [] }), JSON.stringify({ other: 1 })]) assert.equal(catalogFrom(text), null, text);
  // The program is asked for its catalog, with no model call, and a failed or refused render reads as not known.
  const asked = [];
  const run = (bin, args) => { asked.push(args); return { status: 0, stdout: JSON.stringify({ models: [{ slug: "gpt-6-luna" }] }) }; };
  assert.deepEqual([...readCodexCatalog({ env: { CLEAROTRON_CODEX_PATH: "/usr/local/bin/codex" }, run })], ["gpt-6-luna"]);
  assert.deepEqual(asked, [["debug", "models"]]);
  assert.equal(readCodexCatalog({ env: { CLEAROTRON_CODEX_PATH: "/usr/local/bin/codex" }, run: () => ({ status: 1, stdout: "" }) }), null);
  assert.equal(readCodexCatalog({ env: { CLEAROTRON_CODEX_PATH: "/usr/local/bin/codex" }, run: () => { throw new Error("ENOENT"); } }), null);
});

test("a run's question route is frozen once, kept on resume, and the report credits Perplexity only where every fallback question was answered", async () => {
  const { freezeQuestionRoute, questionRoute, fallbackReport } = await import("../web-research.mjs");
  const runDir = mkdtempSync(join(tmpdir(), "web-research-route-"));
  try {
    assert.equal(questionRoute(runDir), null);
    assert.equal(freezeQuestionRoute(runDir, { route: "perplexity", model: "gpt-6.2-sol", disclosure: "d" }), "perplexity");
    assert.equal(freezeQuestionRoute(runDir, { route: "own" }), "perplexity", "a frozen route is never rewritten");
    assert.equal(questionRoute(join(runDir, "_experiments", "arm")), "perplexity", "an experiment's arm reads its run's route");
    const log = (rows) => writeFileSync(driverDir(runDir, "reading-log.jsonl"), rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
    const q = (over) => ({ tool: "perplexity_research", args: { task: "q" }, ...over });
    assert.deepEqual(fallbackReport(runDir), { line: null, answered: 0, failed: 0 }, "no call log: nothing attributed");
    log([q({ ok: true }), q({ ok: true, fallback: true }), q({ ok: true, fallback: true, args: { task: "", grid: true } })]);
    assert.deepEqual(fallbackReport(runDir), { line: "Perplexity answered the deepest research questions.", answered: 1, failed: 0 });
    log([q({ ok: true, fallback: true }), q({ ok: false, fallback: true })]);
    assert.deepEqual(fallbackReport(runDir), { line: null, answered: 1, failed: 1 }, "some failed: the actual outcome is reported, not the sentence");
    log([q({ ok: true })]);
    assert.deepEqual(fallbackReport(runDir), { line: null, answered: 0, failed: 0 }, "none asked: no work is attributed to the fallback");
  } finally { rmSync(runDir, { recursive: true, force: true }); }
});

test("an order says before it starts that Perplexity will answer its deepest questions, or which stop it would meet", async () => {
  const { orderResearchNotice } = await import("../web-research.mjs");
  const lacking = () => new Set(["gpt-6.1-terra", "gpt-6.1-sol", "gpt-6-luna"]);
  const OWN_CODEX = { CLEAROTRON_WEB_RESEARCH: "own", CLEAROTRON_AI: "openai-agent" };
  assert.deepEqual(orderResearchNotice({ product: "full-country-search", env: { ...OWN_CODEX, CLEAROTRON_WEB_RESEARCH_FALLBACK: "perplexity", PERPLEXITY_API_KEY: "k" }, readCatalog: lacking }),
    { notice: "Perplexity will handle any questions that need the deepest research level." });
  assert.deepEqual(orderResearchNotice({ product: "full-country-search", env: OWN_CODEX, readCatalog: lacking }),
    { stop: "This Codex sign-in lacks the model needed for Full country. Configure the Perplexity fallback or choose a supported AI setup. (CLEAROTRON_WEB_RESEARCH_FALLBACK=perplexity, with PERPLEXITY_API_KEY)" });
  assert.equal(orderResearchNotice({ product: "multi-country-focus-search", env: OWN_CODEX, readCatalog: lacking }), null);
  assert.equal(orderResearchNotice({ product: "full-country-search", env: { CLEAROTRON_WEB_RESEARCH: "perplexity", CLEAROTRON_AI: "openai-agent" }, readCatalog: lacking }), null, "Perplexity installs show nothing");
  assert.equal(orderResearchNotice({ product: "full-country-search", env: { CLEAROTRON_WEB_RESEARCH: "own", CLEAROTRON_AI: "anthropic-agent" }, readCatalog: () => { throw new Error("not read"); } }), null, "Claude's catalog is not read");
});
