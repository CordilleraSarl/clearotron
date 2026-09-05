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
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { enablePlan } from "../../shared/client-door.mjs";
import { unitHealthVerdict } from "../../shared/server-units.mjs";

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

// ── 2203 · THE THIRD INVENTED PROBLEM, FOUND AFTER THE OTHER TWO WERE FIXED ─────────────────────────
//
// `connect`'s health probe required `NRestarts === "0"` on top of the state pair. That is the same
// defect fixed in `start --background`'s health check, and fixing it there left this
// copy standing — the class-not-the-instance failure, in the file the client goes through to get
// enrolled. NRestarts is a LIFETIME counter incremented by systemd's OWN auto-restart, so a door that
// crash-looped, recovered and has served ever since reads `active/running` carrying a permanent
// non-zero count. `connect` called that door unhealthy, on every box whose door has ever gone down.
//
// The comment that justified it — "a restart counter above zero means it has already died at least
// once, whatever it says right now" — is TRUE, and is the wrong question. What was asked is whether the
// door works now.

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

test("2203 a door that died once and recovered is HEALTHY — the refusal connect used to invent", () => {
  // Driven on the authority itself, not matched in connect's source: the recovered-unit case IS the
  // finding, and a source match would go green on a verdict that still used the counter somewhere else.
  const recovered = { activeState: "active", subState: "running", nRestarts: "15" };
  assert.equal(unitHealthVerdict(recovered).ok, true,
    "a running door with a lifetime restart count was called unhealthy");
  assert.equal(unitHealthVerdict(recovered).restarts, 15, "the count is still reported as history");
});

test("2203 and a door actually looping is STILL refused — the plant, so the arm above is not a licence", () => {
  // Removing a refusal is easy to overdo. This is the control: the state pair is what catches a real
  // loop, and it must still catch it with the counter gone.
  assert.equal(unitHealthVerdict({ activeState: "activating", subState: "auto-restart", nRestarts: "15" }).ok, false);
  assert.equal(unitHealthVerdict({ activeState: "activating", subState: "auto-restart", nRestarts: "0" }).ok, false,
    "a loop with a cleared counter must still be caught, or the fix moved the blind spot");
  assert.equal(unitHealthVerdict({ activeState: "inactive", subState: "dead", nRestarts: "0" }).ok, false);
});

test("2203 connect holds no second opinion about health — one authority, and this is the file that had two", () => {
  // A SOURCE-SHAPE CLAIM, and said so rather than dressed up: `unitIsHealthy` shells out to systemctl
  // and is not exported, so what is checkable here is that it asks the shared verdict and keeps no
  // comparison of its own. The behaviour it delegates to is driven by the two arms above.
  const src = readFileSync(join(REPO, "bin", "connect.mjs"), "utf8");
  const code = src.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
  assert.match(code, /unitHealthVerdict\(/, "connect no longer asks the shared verdict");
  assert.doesNotMatch(code, /NRestarts\s*===/, "connect compares NRestarts itself again — the second opinion is back");
});
