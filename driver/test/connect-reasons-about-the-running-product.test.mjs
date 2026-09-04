// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// — F40 and F39. `doctor` invented problems; `connect` invented problems AND
// REFUSED TO ACT. On a correctly-running install it said the installation was not on the internet (the
// public URL was set and answering from outside), that the install had no access file (it had had one
// for hours), and that its port was taken (its own healthy door was on it). The owner hand-copied seven
// already-correct values between two env files to get past refusals about correct configuration.
//
// Both fixes remove a refusal, so both arms below assert a NEGATIVE — that a correct install is not
// refused. An arm like that passes just as well against a check that stopped checking, so each is
// paired with a plant that proves the refusal still fires when it is true.

import { test } from "node:test";
import assert from "node:assert/strict";
import { enablePlan } from "../../shared/client-door.mjs";

const BASE = {
  env: { TRADEMARK_MCP_TOKEN_SECRET: "x", CLIENT_MCP_HTTP_PORT: "18811" },
  address: "http://127.0.0.1:18811",
  identity: "lawyer@acme.example",
};

// A blocker is `{why, fix}`. Reading the wrong field would make every arm below pass by finding
// nothing, including the ones asserting a refusal IS present — so the shape is pinned first.
const portBlocker = (plan) =>
  (plan.blockers ?? []).find((b) => /already in use/.test(typeof b === "string" ? b : (b?.why ?? "")));

test("2176-F39 the blocker shape this file matches on is the shape enablePlan produces", () => {
  const plan = enablePlan({ ...BASE, portOwner: () => "stranger" });
  assert.ok(Array.isArray(plan.blockers) && plan.blockers.length, "expected blockers to inspect");
  assert.ok(plan.blockers.every((b) => typeof b?.why === "string"),
    `blockers are no longer {why, fix} and every matcher below is reading a field that is not there: ${JSON.stringify(plan.blockers)}`);
});

test("2176-F39 our own healthy door holding the port is NOT a blocker — it is the state connect wants", () => {
  // The permanent refusal, in one arm. On any --background install the door is always listening, so
  // the old bind test answered "occupied" forever on a machine that was entirely correct.
  const plan = enablePlan({ ...BASE, portOwner: () => "ours" });
  assert.equal(portBlocker(plan), undefined,
    `connect refused because its own door was already up: ${JSON.stringify(plan.blockers)}`);
});

test("2176-F39 THE PLANT — a stranger on the port is still refused, with the remedy", () => {
  // The 2026-08-31 incident: 18811 held by another user's client face while our unit crash-looped
  // beside it. That refusal is correct and must survive the fix that removed the other one.
  const plan = enablePlan({ ...BASE, portOwner: () => "stranger" });
  const b = portBlocker(plan);
  assert.ok(b, "a port held by somebody else's process must still stop the door being pointed at it");
  assert.equal(plan.possible, false);
});

test("2176-F39 a port we could not ask about does not refuse — a failed reader must not block a correct box", () => {
  const plan = enablePlan({ ...BASE, portOwner: () => "unknown" });
  assert.equal(portBlocker(plan), undefined,
    "could-not-look became a permanent refusal once already; it must not become one again");
});

test("2176-F39 the old portIsFree contract is unchanged for callers that cannot ask who owns it", () => {
  // render-units.mjs and the existing arms pass portIsFree and nothing else. Their meaning of `false`
  // was always "somebody else is there", so it must keep refusing exactly as it did.
  assert.ok(portBlocker(enablePlan({ ...BASE, portIsFree: () => false })),
    "a caller with only a bind result still gets the refusal it always got");
  assert.equal(portBlocker(enablePlan({ ...BASE, portIsFree: () => true })), undefined);
  // And with neither, nothing about ports is asserted at all.
  assert.equal(portBlocker(enablePlan({ ...BASE })), undefined);
});

test("2176-F39 portOwner outranks portIsFree, so the richer answer is the one that decides", () => {
  // connect passes both — portIsFree for the shape enablePlan has always had, portOwner for the
  // question it was standing in for. If the coarse one won, the fix would be inert.
  const plan = enablePlan({ ...BASE, portIsFree: () => false, portOwner: () => "ours" });
  assert.equal(portBlocker(plan), undefined,
    "the bind said occupied and the owner said it is ours — ours is the answer that matters");
});

// ── F40: the environment the reasoning is done against ─────────────────────────────────────────────

test("2176-F40 connect resolves the units' environment rather than the CLI's env file", async () => {
  // The asymmetry was one line: this verb WRITES to ~/.env and READ from process.env, which on a
  // packaged install is node_modules/clearotron/.env. Asserted at source because the seam is which
  // environment the deployment picture is built from, and a spawn would need real installed units.
  const { readFileSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  const { join, dirname } = await import("node:path");
  const HERE = dirname(fileURLToPath(import.meta.url));
  const src = readFileSync(join(HERE, "..", "..", "bin", "connect.mjs"), "utf8");

  assert.match(src, /const have = deploymentHas\(running\.env\)/,
    "the deployment picture must be built from the units' environment, not this process's");
  assert.match(src, /function runningEnv\(\)/, "the resolver must exist by name");
  assert.match(src, /unitEnvironment\(\{/, "and must go through the one authority, not a second reader");
  // The could-not-look path is the acceptance criterion's own words: resolve it, or say you could not.
  assert.match(src, /running\.hosted && !running\.known/,
    "an unreadable unit environment must be announced, not silently replaced by this shell's");
});

test("2176-F40 with no units installed, this shell IS the honest thing to read", async () => {
  // Not a could-not-look: `start` supervises and derives values at runtime, so there is genuinely no
  // unit environment to be wrong about. Reporting uncertainty here would red every laptop.
  const { readFileSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  const { join, dirname } = await import("node:path");
  const HERE = dirname(fileURLToPath(import.meta.url));
  const src = readFileSync(join(HERE, "..", "..", "bin", "connect.mjs"), "utf8");
  const fn = src.slice(src.indexOf("function runningEnv()"), src.indexOf("/** What this deployment has"));
  assert.match(fn, /known: true, hosted: false/,
    "no units must resolve as known-and-not-hosted, never as an uncertainty a reader has to act on");
});
