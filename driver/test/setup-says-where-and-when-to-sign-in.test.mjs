// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A newcomer signed in to nothing answered yes to setup's proof turn, and met five problems on the way to
// the sign-in command:
//   · nothing before the question said that trying a program not yet signed in costs nothing, or that the
//     sign-in command follows;
//   · nothing said that the AI is saved only once the turn works, so answering no returns to the AI question;
//   · "run … once in a terminal" meant a second terminal, because setup was still waiting in the first;
//   · "then answer yes below" was followed first by "Did that give you a token to paste?", which wants no
//     after a sign-in in the browser;
//   · on Codex, setup refused before it started the program, and still printed "engine said: nothing — it
//     produced no output…" and "(that reading is config)" under a refusal that described a setting as
//     "NOT an aliased name, and deliberately left as it is".
//
// No turn is run here. The Codex refusal is the real adapter's, which refuses before it starts anything; the
// mock program is named all the same, so nothing real could start if that ever changed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { proofPreamble, proofEvidence, signInHandOff } from "../../bin/onboard.mjs";
import { ENGINE_BINARIES } from "../driver.config.mjs";
import { classifyProbe, probeFailureText } from "../engine/probe.mjs";
import { openaiAgentEngine } from "../engine/openai-agent.mjs";
import { pinEnv } from "../../shared/env-aliases.mjs";   // a fixture pins every spelling

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(HERE, "..", "..", "bin", "onboard.mjs"), "utf8");
const installedCopy = (eng) => ({ source: "installed", path: `/opt/engines-example/node_modules/.bin/${eng.fallback}` });

test("before the proof, setup says the AI is saved only once the turn works", () => {
  for (const eng of Object.values(ENGINE_BINARIES)) {
    for (const billing of ["subscription", "api-key", "cloud"]) {
      const text = proofPreamble({ product: eng.product, billing }).join(" ");
      assert.match(text, new RegExp(`saves ${eng.product} as your AI only once this turn works`),
        `${eng.product}, ${billing}: a reader who answers no is not told that nothing is saved: ${text}`);
    }
  }
  // Printed straight above the question it is about.
  assert.match(SRC, /for \(const line of proofPreamble\(\{ product: eng\.product, billing: authPick\.id \}\)\) info\(line\);\n\s*if \(!await confirm\(proveQuestion\(/);
});

test("on a subscription, setup says a try while signed out costs nothing and is followed by the sign-in", () => {
  for (const eng of Object.values(ENGINE_BINARIES)) {
    const text = proofPreamble({ product: eng.product, billing: "subscription" }).join(" ");
    assert.match(text, new RegExp(`If ${eng.product} is not signed in yet, the turn costs nothing`), text);
    assert.match(text, /shows how to sign in/, text);
    // CONTROL: under a key or a cloud account there is no sign-in to follow, so none is promised.
    for (const billing of ["api-key", "cloud"])
      assert.doesNotMatch(proofPreamble({ product: eng.product, billing }).join(" "), /sign in|signed in/, `${eng.product}, ${billing}`);
  }
});

test("the sign-in is run in a second terminal, and the yes it asks for is the retry's", () => {
  for (const [id, eng] of Object.entries(ENGINE_BINARIES)) {
    const { lines } = signInHandOff(eng, installedCopy(eng), "subscription");
    const text = lines.join("\n");
    assert.equal(lines[0], "setup waits in this terminal, so run the commands below in a second one:", `${id}: ${text}`);
    // These lines follow every failed turn on a subscription, a spent quota as much as a sign-out, so the line
    // that applies to all of them tells no one to sign in; the sign-in itself stays conditional.
    assert.doesNotMatch(lines[0], /sign in/, `${id}: a reader whose turn failed for another reason is told to sign in`);
    assert.match(text, /if it is signed out: /, `${id}: ${text}`);
    assert.doesNotMatch(text, /answer yes below/, `${id}: "below" is first the token question, which wants no after a browser sign-in`);
    assert.match(text, /answer yes to "Run the turn again"/, `${id}: ${text}`);
  }
  // The question named is the one setup asks.
  assert.match(SRC, /confirm\("Fixed it\? Run the turn again", false\)/);
});

test("a program refused before it started shows no engine output, and the refusal reads in plain words", async () => {
  const dir = mkdtempSync(join(tmpdir(), "signin-plain-"));
  const env = { CLEAROTRON_AI: "openai-agent", CLEAROTRON_AI_BILLING: "subscription", CODEX_API_KEY: "",
    CLEAROTRON_OPENAI_AUTH_FILE: join(dir, "no-sign-in-here", "auth.json"), CLEAROTRON_CODEX_PATH: join(HERE, "mock-codex.mjs") };
  const saved = {};
  for (const k of Object.keys(env)) { saved[k] = process.env[k]; pinEnv(process.env, k, env[k]); }
  let thrown = null;
  try { await openaiAgentEngine.runTurn({ message: "reply ok", model: "haiku", thinking: "low", timeoutSec: 5, runDir: dir }); }
  catch (e) { thrown = e; }
  finally { for (const k of Object.keys(env)) { if (saved[k] === undefined) delete process.env[k]; else pinEnv(process.env, k, saved[k]); } }
  assert.ok(thrown, "the adapter started a turn with no sign-in file");
  assert.doesNotMatch(thrown.message, /aliased|deliberately|auth\.json at|=subscription but/, `the refusal reads as our reasoning: ${thrown.message}`);
  assert.ok(thrown.message.includes(env.CLEAROTRON_OPENAI_AUTH_FILE), "the refusal names the file it looked for");

  const program = installedCopy(ENGINE_BINARIES["openai-agent"]);
  const v = classifyProbe({ engine: "openai-agent", error: thrown, program });
  assert.equal(v.mode, "signed-out", "the run door and doctor still read it as a sign-in to do");
  assert.ok(probeFailureText(v).includes(`\`${program.path} login\``), `the sign-in names the copy that runs: ${probeFailureText(v)}`);
  assert.deepEqual(proofEvidence(v), [], "a program that never started was reported as having said nothing");

  // CONTROL: a program that ran keeps its own words, and one that ran and said nothing still says so.
  const ran = classifyProbe({ engine: "anthropic-agent", tuple: { code: 1, stdout: "", stderr: "Not logged in · Please run /login", json: {}, signals: {} } });
  assert.equal(proofEvidence(ran)[0], "engine said: Not logged in · Please run /login");
  const silent = classifyProbe({ engine: "anthropic-agent", tuple: { code: 1, stdout: "", stderr: "", json: {}, signals: { noStreamEvents: true } } });
  assert.match(proofEvidence(silent)[0], /^engine said: nothing/);
  // Setup prints these, and only these, as the evidence.
  assert.match(SRC, /problem\(probeFailureText\(v\)\);[\s\S]{0,1600}for \(const line of proofEvidence\(v\)\) info\(line\);/);
  assert.doesNotMatch(SRC, /info\("engine said: nothing/, "a second copy of the evidence lines prints beside the function");
});
