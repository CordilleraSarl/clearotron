// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// WHAT A NEWCOMER'S FIRST `start` AND `doctor` PRINT IS IN PLAIN WORDS.
//
// Measured in a stranger walk of a beta, 2026-11-10: the first screens carried "Staff.", "the revocation list — a key
// revoked before it existed was not revoked at all", "ops token sub=portal verbs=start_run,stop_run", "no door on this
// process", "a due park or an unclaimed job", "doctrine resolves to the bundled files", and "`profile-store` journal
// line". Each now says the same fact in plain words. The service lines keep their first words, which journals are
// searched by. The trigger line and the key-path line are driven where they are made; the rest are read off source,
// where each is one literal.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { triggerLaneLine } from "../portal-service.mjs";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const src = (p) => readFileSync(join(REPO, p), "utf8");
const USUAL = { readable: true, sub: "portal", verbs: ["start_run", "stop_run"], accounts: ["generic"], accountCapped: true,
  expiresAt: "2026-12-10T00:00:00.000Z", daysLeft: 29, expired: false };

test("the Start button's usual key is said in plain words, and an unwired lane still says so first", () => {
  assert.equal(triggerLaneLine(USUAL, true),
    "trigger lane: the Start button may start and stop searches for generic; its key expires 2026-12-10 (29 days)");
  assert.equal(triggerLaneLine({ ...USUAL, accounts: ["demo-brand-owner", "generic"] }, false),
    "trigger lane (NOT WIRED — see above): the Start button may start and stop searches for demo-brand-owner, generic; its key expires 2026-12-10 (29 days)");
});

test("THE CONTROL: a key of any other shape keeps the line that names each field", () => {
  const expiry = " expires=2026-12-10 (29d)";
  for (const [what, posture] of [
    ["every account", { ...USUAL, accounts: null, accountCapped: false }],
    ["another verb", { ...USUAL, verbs: ["start_run", "stop_run", "purge_run"] }],
    ["no known expiry", { ...USUAL, expiresAt: null, daysLeft: null }],
    ["expired", { ...USUAL, expired: true, daysLeft: -3 }],
    ["unreadable", { readable: false, sub: null, verbs: null, accounts: null, accountCapped: false, expiresAt: null }],
  ]) {
    const line = triggerLaneLine(posture, true, expiry);
    assert.match(line, /^trigger lane: ops token sub=/, `${what}: ${line}`);
    assert.doesNotMatch(line, /the Start button may/, `${what} read as the usual key: ${line}`);
  }
});

test("start, the worker and doctor print the approved sentences, and none of the words they replace", () => {
  const start = src("bin/start.mjs"), runner = src("driver/runner.mjs"), onboard = src("bin/onboard.mjs"), door = src("mcp-server/http-server.mjs");
  assert.ok(start.includes("— the portal's Start button calls this. For your staff, not clients.`"), "the engine door's line");
  assert.ok(start.includes("(the list of keys you have revoked)`"), "the revocation list's line");
  assert.ok(runner.includes("[runner] watch: checking every ${Math.round(tickMs / 1000)}s for a search to start or to resume. Ctrl-C to stop."), "the worker's line");
  assert.ok(onboard.includes("`searches follow the product's own instructions, from ${THIS_TREE}`"), "doctor's instructions line");
  assert.ok(onboard.includes('"a search records which profiles it used in its own log — this command reports what the "'), "doctor's profiles line");
  assert.ok(door.includes('"key path: none (TRADEMARK_MCP_KEY_SOCKET is not set), so a program on this machine cannot use an access key here; the client door accepts them"'), "the engine door's key-path line");
  for (const [file, text, words] of [["bin/start.mjs", start, /calls this\. Staff\.`|a key revoked before it existed was not revoked at all/],
    ["driver/runner.mjs", runner, /a due park or an unclaimed job/], ["bin/onboard.mjs", onboard, /`doctrine resolves to the bundled files IN|"what a RUN used is its own `profile-store` journal line/],
    ["mcp-server/http-server.mjs", door, /has no door on this process/]])
    assert.doesNotMatch(text, words, `${file} still prints words the reader could not parse`);
});
