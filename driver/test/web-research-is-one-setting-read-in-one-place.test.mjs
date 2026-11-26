// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// WEB RESEARCH IS ONE SETTING, READ IN ONE PLACE (web-research.mjs).
//
// The installation names its service; an installation that names none keeps Perplexity, its route before the setting
// existed, and says the choice was never made. What each service can run here is decided from the engine and its
// billing route, never from which keys are present, and the check places no search. The run door and the run's record
// read the same answers.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installWebResearch, webResearchCapability, OWN_SEARCH_STILL_PERPLEXITY, WEB_RESEARCH_SETTING, WEB_RESEARCH_SERVICES } from "../web-research.mjs";
import { preflightResearchCredential } from "../driver.config.mjs";
import { policyFor } from "../search-policy.mjs";
import { readRunChoices, recordRunChoices, researchForRun, RunChoiceUnavailable } from "../engine/run-choices.mjs";
import { driverDir } from "../../shared/driver-dir.mjs";

test("the setting names one of two services; unset keeps Perplexity, unchosen; anything else is no service", () => {
  assert.deepEqual(WEB_RESEARCH_SERVICES, ["own", "perplexity"]);
  assert.deepEqual(installWebResearch({}), { service: "perplexity", chosen: false });
  assert.deepEqual(installWebResearch({ [WEB_RESEARCH_SETTING]: "  " }), { service: "perplexity", chosen: false });
  assert.deepEqual(installWebResearch({ [WEB_RESEARCH_SETTING]: " Own " }), { service: "own", chosen: true });
  assert.deepEqual(installWebResearch({ [WEB_RESEARCH_SETTING]: "perplexity" }), { service: "perplexity", chosen: true });
  assert.deepEqual(installWebResearch({ [WEB_RESEARCH_SETTING]: "google" }), { service: null, chosen: true, invalid: "google" });
});

test("a key is never what decides the service", () => {
  assert.equal(installWebResearch({ PERPLEXITY_API_KEY: "k" }).chosen, false, "a key present is not a choice");
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
  // Own search still sends its follow-up questions to Perplexity, so the cases that pass hold its key.
  const KEY = { PERPLEXITY_API_KEY: "secret-value" };
  for (const [args, ok, why] of cases) {
    const r = webResearchCapability({ ...args, env: { ...(args.service === "own" ? KEY : {}), ...(args.env ?? {}) } });
    assert.equal(r.ok, ok, JSON.stringify(args));
    if (why) assert.match(r.why, why, JSON.stringify(args));
    assert.ok(!JSON.stringify(r).includes("secret-value"), "a value reached the answer");
  }
  assert.deepEqual(webResearchCapability({ service: "perplexity", env: {} }).missing, ["PERPLEXITY_API_KEY"]);
});

test("a part own search does not run yet keeps needing the Perplexity key, and the check says which part", () => {
  assert.deepEqual([...OWN_SEARCH_STILL_PERPLEXITY], ["follow-up questions"]);
  const r = webResearchCapability({ service: "own", env: {} });
  assert.equal(r.ok, false);
  assert.deepEqual(r.missing, ["PERPLEXITY_API_KEY"]);
  assert.match(r.why, /still sends its follow-up questions to Perplexity/);
  assert.deepEqual(webResearchCapability({ service: "own", env: { PERPLEXITY_API_KEY: "k" } }).stillPerplexity, ["follow-up questions"]);
  assert.match(webResearchCapability({ service: "own", env: { CLEAROTRON_AI_BILLING: "cloud", CLAUDE_CODE_USE_BEDROCK: "1" } }).why, /Amazon Bedrock/,
    "a route with no search is named first: a key would not make it run");
});

test("the door checks the run's service, and the service handed in wins over the setting", () => {
  const p = policyFor("full-country-search");
  const KEY = { PERPLEXITY_API_KEY: "k" };
  assert.equal(preflightResearchCredential(p, { [WEB_RESEARCH_SETTING]: "own", ...KEY }).service, "own");
  assert.throws(() => preflightResearchCredential(p, { [WEB_RESEARCH_SETTING]: "own" }), /still sends its follow-up questions to Perplexity/);
  assert.throws(() => preflightResearchCredential(p, { [WEB_RESEARCH_SETTING]: "own" }, { service: "perplexity" }), /missing PERPLEXITY_API_KEY/,
    "a run recorded on Perplexity is checked there, whatever the installation now says");
  assert.equal(preflightResearchCredential(p, { PERPLEXITY_API_KEY: "k" }, { service: "own" }).service, "own");
  assert.throws(() => preflightResearchCredential(p, { [WEB_RESEARCH_SETTING]: "own", CLEAROTRON_AI_BILLING: "cloud", CLAUDE_CODE_USE_BEDROCK: "1" }),
    /own web search cannot run here .*Amazon Bedrock/);
  assert.throws(() => preflightResearchCredential(p, { [WEB_RESEARCH_SETTING]: "google" }), /names no web-research service/);
  assert.equal(preflightResearchCredential(policyFor("knockout-search"), { [WEB_RESEARCH_SETTING]: "own", CLEAROTRON_AI_BILLING: "cloud", CLAUDE_CODE_USE_BEDROCK: "1" }).checked, false,
    "a Knockout is never refused at this door");
});

test("the run's record holds its service, reads it back, and a run recorded before the service keeps Perplexity", () => {
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
  } finally { rmSync(runDir, { recursive: true, force: true }); }
});

test("a run whose service this runner cannot serve parks under its own kind", () => {
  const e = new RunChoiceUnavailable({ kind: "research", recorded: "own", machine: "perplexity", detail: "no web search", run: { codename: "probe" } });
  assert.deepEqual(e.dependency, { kind: "research", recorded: "own", machine: "perplexity", detail: "no web search" });
  assert.match(e.message, /started on the own web research, and this runner cannot serve it/);
});
