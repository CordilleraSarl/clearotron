// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// ── F44 — THE ONLY WAY TO ISSUE A KEY COULD NOT READ THE CONFIGURATION ───
//
// Issuing a key for a colleague or a client meant running `mcp-server/mint-token.mjs` by hand. That
// script never imported `shared/env-local.mjs`, so on a FULLY CONFIGURED install it refused:
//
//     mint-token: TRADEMARK_MCP_TOKEN_SECRET is unset — refusing (fail-closed)
//
// The secret was set, in both env files. Failing closed on a missing secret is right; failing closed on
// a configured install because the only issuance path cannot read the configuration is not — and the
// documented way round it was worse than the refusal: lift the signing secret out of an env file and
// put it on the command line, which is to say into shell history.
//
// So issuance is a verb that loads configuration like every other verb, and the operator never handles
// the secret. `mint-token.mjs` stays the implementation; `bin/key.mjs` is the interface.
//
// BREAK MATRIX:
//   · the verb loads the install's .env FIRST         → break: drop the import, arm 1 red
//   · exactly ONE thing decides what a token is       → break: mint separately in the verb, arm 2 red
//   · a configured install issues a key               → break: any of the above, arm 3 red
//   · an UNconfigured one refuses, naming the remedy  → break: generic message, arm 4 red
//   · the refusal never tells anyone to set it inline → break: suggest it, arm 4 red
//   · the verb is reachable from the one command      → break: unregister it, arm 5 red
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { VERBS, SUMMARY } from "../../bin/clearotron.mjs";
import { nonEmpty } from "../../shared/vacuous-pass.mjs";

const ROOT = join(dirname(dirname(fileURLToPath(import.meta.url))), "..");
const KEY_SRC = readFileSync(join(ROOT, "bin", "key.mjs"), "utf8");

/** Run the verb with a controlled environment; `CLEAROTRON_NO_ENV_FILE` keeps this checkout's .env out. */
const runKey = (args, env = {}) => spawnSync(process.execPath, [join(ROOT, "bin", "key.mjs"), ...args], {
  encoding: "utf8", cwd: ROOT, env: { ...process.env, CLEAROTRON_NO_ENV_FILE: "1", TRADEMARK_MCP_TOKEN_SECRET: "", ...env },
});

test("the verb loads the install's configuration, and loads it FIRST", () => {
  assert.match(KEY_SRC, /import "\.\.\/shared\/env-local\.mjs";/,
    "the issuance verb does not load the install's .env — the defect it was written for");
  // FIRST, not merely present. A module that read process.env at import before this ran would see the
  // unloaded environment and disagree with every other reader — the reason env-local's own header gives.
  const envLocal = KEY_SRC.indexOf('import "../shared/env-local.mjs"');
  const otherImports = [...KEY_SRC.matchAll(/^import .*$/gm)].map((m) => m.index);
  assert.equal(Math.min(...otherImports), envLocal, "another import runs before the environment is applied");
});

test("there is still exactly ONE thing that decides what a valid token is", () => {
  // The verb must DELEGATE. A second `mintToken` call here would be a second opinion, and the one that
  // was wrong would be the one nobody read.
  assert.match(KEY_SRC, /mintFromOptions/, "the verb no longer calls the shared issuance path");
  assert.doesNotMatch(KEY_SRC, /\bmintToken\s*\(/,
    "the verb mints on its own terms — that is a second issuance path, which is what this fix removed");
  const mintSrc = readFileSync(join(ROOT, "mcp-server", "mint-token.mjs"), "utf8");
  assert.equal((mintSrc.match(/\bmintToken\(/g) ?? []).length, 1,
    "the implementation mints in more than one place");
});

test("on a configured install it issues a key, and prints the token exactly once", () => {
  const r = runKey(["issue", "lawyer@acme.example"], { TRADEMARK_MCP_TOKEN_SECRET: "test-secret-value" });
  assert.equal(r.status, 0, `a configured install refused to issue: ${r.stderr}`);
  const out = r.stdout.trim().split("\n").filter(Boolean);
  assert.equal(out.length, 1, "the token is not the only thing on stdout — it is piped, so anything else corrupts it");
  assert.match(out[0], /^v1\./, "what landed on stdout is not a token");
  // The operator-facing record goes to stderr, and it carries the revocation handle.
  assert.match(r.stderr, /jti=[0-9a-f]+/, "the jti that revokes the key is not reported");
  assert.match(r.stderr, /scope=account sub=lawyer@acme\.example/, "the summary does not say what was minted");
});

test("an unconfigured install still refuses — naming the remedy, and never the inline secret", () => {
  const r = runKey(["issue", "lawyer@acme.example"]);
  assert.notEqual(r.status, 0, "an install with no signing secret issued a key");
  assert.match(r.stderr, /no token signing secret/, "the refusal does not say what is missing");
  assert.match(r.stderr, /clearotron start/, "the refusal does not name what writes one");
  // THE POINT OF THE WHOLE FINDING. The old workaround was to put the signing secret on the command
  // line; a refusal that suggests it would reinstate the defect in the remedy.
  assert.match(r.stderr, /shell history/, "the refusal does not warn against the workaround it replaces");
  assert.doesNotMatch(r.stderr, /TRADEMARK_MCP_TOKEN_SECRET=/,
    "the refusal shows the operator how to set the secret inline — that is the defect, in the remedy");
});

test("the verb is reachable from the one command, and says what it is for", () => {
  nonEmpty(Object.keys(VERBS), "the verb table is empty — this arm would prove nothing");
  assert.deepEqual(VERBS.key, ["bin/key.mjs"], "`key` is not a verb, so the documented path is a raw script again");
  assert.ok((SUMMARY.key ?? "").trim().length > 20, "the verb has no summary, so it is invisible in the verb list");
  assert.match(SUMMARY.key, /grant/, "the summary does not say that enrolment comes first — a key alone reaches nothing");
});
