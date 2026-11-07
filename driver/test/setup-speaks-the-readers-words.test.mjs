// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// SETUP SPEAKS THE READER'S WORDS, NOT THE PROGRAM'S.
//
// A stranger install of a beta found eight lines in setup that used the program's own vocabulary: the AI's
// setting value where setup's questions say "Claude", how a verdict was read, the adapter, the driver's
// preflight, doctrine, a page called by a name the portal does not use (measured 2026-11-05). The owner gave
// each its words, and four more lines that said the same things took the same words. This file pins those
// that nothing else pinned, each by the words the owner approved.
//
// The wizard's own lines are read where they are printed: a sentence with a value in it comes from a small
// composer the wizard calls, driven here with an invented folder, and a plain sentence is read from the
// source, in its place. Nothing here runs the wizard or an engine.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { classifyProbe, probeFailureText } from "../engine/probe.mjs";
import { ENGINE_BINARIES } from "../driver.config.mjs";
import { clientDoorReachability } from "../../shared/client-door.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(HERE, "..", "..", "bin", "onboard.mjs"), "utf8");
// A namespace, not named imports: a composer that is missing fails its own test, not the whole file.
const onboard = await import("../../bin/onboard.mjs");
const CFG = join("/srv", "clearotron", "config");   // an invented configuration folder

/** The index of `needle` in the wizard's source, which must hold it exactly once. */
function onceIn(needle, what) {
  const at = SRC.indexOf(needle);
  assert.notEqual(at, -1, `${what}: the wizard does not print this sentence`);
  assert.equal(SRC.indexOf(needle, at + 1), -1, `${what}: the wizard holds this sentence twice`);
  return at;
}

const signedOut = classifyProbe({ engine: "anthropic-agent",
  tuple: { code: 1, stdout: "", stderr: "Not logged in · Please run /login", json: {}, signals: {} } });

test("a failed test turn's first line names the AI as setup's questions do, and only setup's does", () => {
  assert.equal(typeof onboard.proofFailureLine, "function", "setup has no composer for its failure line");
  assert.match(onboard.proofFailureLine(signedOut, "Claude"),
    /^Claude is not signed in — Sign in: .+, then run this again\. Setup does not do it for you — the CLI owns its own login\.$/);
  const codex = classifyProbe({ engine: "openai-agent", error: new Error("Codex has no sign-in on this machine: run `codex login`") });
  assert.match(onboard.proofFailureLine(codex, ENGINE_BINARIES["openai-agent"].product), /^Codex is not signed in — /);
  // The probe's own words keep the setting's value: doctor --probe-engine and a run's own check print those.
  assert.match(probeFailureText(signedOut), /^anthropic-agent is not signed in — /);
});

test("the line under the program's words says, in plain words, that setup read the failure from them", () => {
  assert.equal(onboard.proofEvidence(signedOut)[1], "(setup's reading of the words above, not a status the program reported)");
  // Every other way of reading a failure keeps today's line.
  const silent = classifyProbe({ engine: "anthropic-agent", tuple: { code: 1, stdout: "", stderr: "", json: {}, signals: { noStreamEvents: true } } });
  assert.equal(onboard.proofEvidence(silent)[1], `(that reading is ${silent.basis})`);
});

test("Codex's subscription answer says how to sign in, and nothing about the adapter", () => {
  const pay = onboard.payQuestion({ engineId: "openai-agent", eng: ENGINE_BINARIES["openai-agent"], bin: null });
  assert.equal(pay.answers.find((a) => a.id === "subscription").label, "Subscription — sign in once with `codex login`");
});

test("custom instructions are described as custom instructions, with how to add one later", () => {
  assert.equal(typeof onboard.customInstructionsNone, "function", "setup has no composer for its custom-instructions line");
  assert.equal(onboard.customInstructionsNone(CFG), "Custom instructions: none, so CLEAROTRON_INSTRUCTIONS_DIR stays unset "
    + "and the product's own instruction files are used. To override one later, put your copy in "
    + `${join(CFG, "skills")}, commit it in ${CFG}, and set CLEAROTRON_INSTRUCTIONS_DIR to that folder. A run cannot `
    + "identify an uncommitted folder, and says so rather than guessing.");
  onceIn("info(customInstructionsNone(cfg));", "custom instructions");
});

test("the empty configuration folder is described by what a search then uses", () => {
  assert.equal(onboard.EMPTY_CONFIG_FOLDER, "Left empty, and an empty folder is a working install: searches use the "
    + "product's own instruction files and its Generic defaults, each until you add your own. Your own customers are "
    + "added here; the demo's sample customers never appear among them.");
  onceIn("prose(EMPTY_CONFIG_FOLDER);", "the empty folder");
});

test("the folders setup creates are described in the same words", () => {
  assert.equal(typeof onboard.configFoldersMade, "function", "setup has no composer for the folders it creates");
  assert.equal(onboard.configFoldersMade(CFG), `configuration directories created under ${CFG} (empty: the product's own `
    + "instruction files and its Generic defaults apply, each until you add your own)");
  onceIn("ok(configFoldersMade(cfg));", "the folders created");
});

test("the register check's result names the register and what it checked, as the register credential check", () => {
  assert.equal(typeof onboard.registerCheckPassed, "function", "setup has no composer for the check's result");
  assert.equal(onboard.registerCheckPassed("signa", "SIGNA_API_KEY"),
    "the register credential check passed for \"signa\" — checked SIGNA_API_KEY");
  onceIn("ok(registerCheckPassed(pf.result.provider, pf.result.checked.join(\" + \")));", "the check's result");
});

// The public-address step, in the order a reader meets it: its heading, the sentence that says what skipping
// it means, the prompt, and the prompt's skipped line. The summary's line comes at the end of setup.
const prompt = () => onceIn('askValue("Public connector address:"', "the step's prompt");

test("the public-address step calls the portal's page by the portal's own name, before its prompt", () => {
  const heading = onceIn('say("\\n  Optional: the public connector address");', "the step's heading");
  const at = onceIn(JSON.stringify("No default — it is your hostname. Skip it and this stays a local install: everything "
    + "works here, and the Connect your AI page says so rather than handing out an address that fails."), "the step's sentence");
  assert.ok(heading < at && at < prompt(), "the sentence is not between the step's heading and its prompt");
});

test("a skipped public address says which pages show their empty state, by the portal's own names", () => {
  const at = onceIn(JSON.stringify("CLEAROTRON_CLIENT_MCP_URL left unset — the Connect your AI page and a report's Ask AI "
    + "control will show their empty state, which is correct for a local install"), "the skipped line");
  assert.ok(at > prompt() && at - prompt() < 300, "the skipped line is not the prompt's own");
});

test("setup's closing summary names the Connect your AI page", () => {
  onceIn('stateLine("client connector", candidate.CLEAROTRON_CLIENT_MCP_URL, '
    + JSON.stringify("local install; the Connect your AI page shows its empty state") + ")", "the summary's line");
});

test("doctor's line for an install with no public address uses the portal's names too", () => {
  const unset = clientDoorReachability({ url: null });
  assert.equal(unset.state, "unset");
  assert.equal(unset.message, "no client connector address is published, so the Connect your AI page and a report's "
    + "Ask AI control will say this deployment is not set up. That is correct for a local install.");
});
