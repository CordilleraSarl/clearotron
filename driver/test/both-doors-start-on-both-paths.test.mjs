// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// — F26. Owner ruling, restated several times in session: START BOTH.
//
// The ruling already held on the systemd path — the client door is in SERVER_INSTALL_SET on the 2148
// ruling that the door auto-starts and the per-account key is the gate — and did not hold on the
// foreground path, with nothing in the output saying which of the two you were on. The owner spent the
// leg believing MCP had not started at all. It had: the STAFF door was up, and the door he was looking
// for was the other one. Two doors, two audiences, and the output named neither as a door.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { childEnv, resolvePorts, BACKGROUND_UNITS } from "../../bin/start.mjs";
import { clientDoorPort } from "../../shared/client-door.mjs";
import { unitsToRestartOnRefresh, unitHealthVerdict } from "../../shared/server-units.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..");

const BASE = {
  ports: resolvePorts({}),
  paths: { base: "/i", pool: "/i/pool", workspace: "/i/w", queue: "/i/q", outbox: "/i/o",
    locks: "/i/l", grants: "/i/grants.json", audit: "/i/audit", recipes: "/i/r", configStore: "/i/c" },
  user: "op@localhost", staffDomains: "localhost", portalSecret: "s", tokenSecret: "t", opsToken: "o",
};

test("2176-F26 the foreground path composes an environment for the client door at all", () => {
  const envs = childEnv(BASE);
  assert.ok(envs.client, "there was no client-door environment, so the foreground path cannot start one");
  assert.equal(envs.client.CLIENT_MCP_HTTP_PORT, String(clientDoorPort({})));
});

test("2176-F26 the door is SPAWNED on the foreground path, not merely configured for", () => {
  // Composing an env a spawn never uses is the shape this finding already had once: the ruling held in
  // one place and not the other, and nothing said so.
  assert.match(START_SRC, /start\("the client door", "mcp-server\/http-server-client\.mjs", envs\.client/,
    "the foreground path must actually start the door it composes an environment for");
  // Non-fatal, for the reason the worker is: an install that refuses to come up because one door could
  // not bind is worse than one serving the portal without it.
  assert.match(START_SRC, /"mcp-server\/http-server-client\.mjs", envs\.client, \{ fatal: false \}/,
    "a door that cannot bind must not take the portal down with it");
});

test("2176-F26 PARITY — the door's foreground environment carries what the units give it", () => {
  // The ruling is about parity, so this compares against what the door needs rather than a list typed
  // out here: the access file and the token secret reach it exactly as they reach the units, because
  // they come from the same shared block.
  const envs = childEnv(BASE);
  assert.equal(envs.client.CLEAROTRON_ACCESS_FILE, BASE.paths.grants,
    "the door scopes every caller against the guest list; without it the door cannot answer anyone");
  assert.equal(envs.client.TRADEMARK_MCP_TOKEN_SECRET, "t",
    "the door verifies keys with this; without it the door dies at birth");
  assert.equal(envs.client.CLEAROTRON_NO_ENV_FILE, "1",
    "children are configured by what they are handed, like every other child on this path");
  // The allow-list is derived from the same number the listener is given, never written twice.
  assert.equal(envs.client.CLIENT_MCP_ALLOWED_HOSTS,
    `127.0.0.1:${envs.client.CLIENT_MCP_HTTP_PORT},localhost:${envs.client.CLIENT_MCP_HTTP_PORT}`);
});

test("2176-F26 the fence defaults to the units' value and an operator's OWN decision survives", () => {
  // NOT A NEW EXPOSURE. "1" is what enablePlan writes into the unit env file, so both paths agree; a
  // door reachable with no key issued refuses everything, which is the protection the ruling relies on.
  assert.equal(childEnv(BASE).CLIENT_MCP_ACCOUNT_ACCESS, undefined,
    "the fence belongs to the door's environment, not to every child");
  assert.equal(childEnv(BASE).client.CLIENT_MCP_ACCOUNT_ACCESS, "1");
  // And a deliberate 0 is a decision, not a default to be overwritten.
  assert.equal(childEnv({ ...BASE, clientFence: "0" }).client.CLIENT_MCP_ACCOUNT_ACCESS, "0",
    "an operator who turned account access off must not have it turned back on by starting the product");
});

test("2176-F26 the summary names BOTH doors, their ports, and who each is for", () => {
  // The ambiguity is what cost the leg: "MCP is running" says nothing on a box with two of them.
  assert.match(START_SRC, /Engine door.*Staff\./s, "the staff door must be named as a door, and as staff's");
  assert.match(START_SRC, /Client door/, "the client door must be named as a door");
  assert.match(START_SRC, /a client's assistant connects here/,
    "each door must say who it is for, not merely that it exists");
  // A door that did not come up must say so rather than be silently absent from the summary.
  assert.match(START_SRC, /Client door {2}NOT RUNNING on/,
    "a door that failed to start must be reported, not omitted — an absence reads as 'fine'");
  // The branch must turn on the SYNCHRONOUS truth. `rec.alive` is flipped by an async exit handler, so
  // reading it asks whether the event loop has delivered the exit yet — the margin is real today and
  // nothing pinned it. Found in review by role-dev/Grogu.
  assert.match(START_SRC, /clientDoor\?\.child\?\.exitCode === null/,
    "the not-running branch must read child.exitCode, which the runtime sets when the process is reaped");
});

/**
 * A port the kernel says is free right now —.
 *
 * Bind :0, read what was assigned, release it. The window between release and the door's own bind is
 * milliseconds and it is the only race left; a hardcoded port is not a race but a standing appointment,
 * held for as long as any other lane's copy of this suite runs. Where an arm can keep the socket instead
 * of releasing it — the squatter below — it does, and has no window at all.
 */
async function freePort() {
  const { createServer } = await import("node:net");
  const s = createServer();
  await new Promise((r) => s.listen(0, "127.0.0.1", r));
  const { port } = s.address();
  await new Promise((r) => s.close(r));
  return port;
}

test("2176-F26 THE DOOR ACTUALLY BOOTS on the composed environment — shape is not the same as starting", async () => {
  // THIS ARM EXISTS BECAUSE THE OTHERS PASSED WHILE THE DOOR DIED AT BIRTH. Every assertion above was
  // green on an environment that made the door exit 1 on its first line:
  //
  //   FATAL: auth enabled but CLEAROTRON_CLIENT_OIDC_AUDIENCE plus CF_ACCESS_TEAM or
  //   CLIENT_MCP_OIDC_ISSUER … are missing — refusing to start (fail-closed)
  //
  // CLIENT_MCP_TOKEN_ONLY was missing. Asserting the presence of names cannot catch the absence of one
  // nobody thought to name, so the only honest check is to start the thing and require it to answer.
  // Found by driving it, not by reading the diff.
  const { spawn } = await import("node:child_process");
  const { mkdtempSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  // ── ✕ A FIXED PORT IS A COLLISION BETWEEN LANES, NOT A CONSTANT ─────────
  //
  // This was `const PORT = 18947`, chosen to avoid the door's own default 18811 because a real install
  // may hold that. Right about the install and wrong about the box: 18947 is fixed too, so it belongs to
  // whichever copy of this suite binds it first. Measured 2026-09-05 — this arm red during one lane's
  // guard run while another lane ran the same suite in its own checkout, and the product refused exactly
  // as it should ("the product's ports are fixed defaults, so two checkouts on one box collide"). It was
  // NOT a leaked process: nothing held the port seconds later, only this file in the whole set binds it,
  // and the file passed alone. Two concurrent lanes are enough on their own, and the export lane runs
  // this suite in a second checkout BY DESIGN.
  //
  // The cost is not the minute. The lane that loses the race gets a red it cannot tell apart from its own
  // regression, and "known flake" is how a real failure hides.
  //
  // The PRODUCT's fixed default stays untouched — a door that quietly moved to another port would be a
  // worse product, and its refusal here is correct behaviour being reported. What changes is the arm.
  const PORT = await freePort();
  const base = mkdtempSync(join(tmpdir(), "f26-boot-"));
  writeFileSync(join(base, "grants.json"), `${JSON.stringify({ tenants: {} }, null, 2)}\n`);
  const envs = childEnv({ ...BASE,
    ports: { ...BASE.ports, client: PORT },
    paths: { ...BASE.paths, base, grants: join(base, "grants.json"), denylist: join(base, "denylist") },
    tokenSecret: "t".repeat(32) });

  const child = spawn(process.execPath, [join(REPO, "mcp-server", "http-server-client.mjs")],
    { env: { PATH: process.env.PATH, HOME: base, ...envs.client }, stdio: ["ignore", "pipe", "pipe"] });
  const pid = child.pid;                       // recorded, and the only thing this arm ever kills
  let out = "";
  child.stdout.on("data", (d) => { out += d; });
  child.stderr.on("data", (d) => { out += d; });
  try {
    const exited = await Promise.race([
      new Promise((r) => child.once("exit", (c) => r(c))),
      new Promise((r) => setTimeout(() => r(null), 8000)),
    ]);
    assert.equal(exited, null,
      `the door exited instead of serving on the environment the foreground path composes:\n${out}`);
    // Alive is not answering. A 401 from a token-only door IS the door answering, and is the state the
    // ruling relies on: reachable, and refusing everyone until a key is issued.
    const res = await fetch(`http://127.0.0.1:${PORT}/mcp`, { method: "GET", signal: AbortSignal.timeout(4000) });
    assert.ok(res.status < 500, `the door answered ${res.status}; a 5xx is not a door serving:\n${out}`);
  } finally { try { process.kill(pid); } catch { /* already gone */ } }
});

test("2176-F26 a door that CANNOT bind is reported as not running — driven, not read", async () => {
  // Grogu's review point, as an arm rather than an expression taken on trust: occupy the port first,
  // then require the door to fail and the summary's NOT RUNNING branch to be the reachable one. The
  // defect this refuses is F26's own, relocated into its failure path — a dead door announced as one a
  // client's assistant connects to.
  const { createServer } = await import("node:net");
  const { spawn } = await import("node:child_process");
  const { mkdtempSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  // The squatter asks the KERNEL for the port rather than naming one (, same class as
  // the arm above). Here there is no race left at all: this arm's whole purpose is to hold the port, so
  // binding :0 and reading back what it was given is both collision-free and a more honest expression of
  // "a port something else already has".
  const squatter = createServer();
  await new Promise((r) => squatter.listen(0, "127.0.0.1", r));
  const PORT = squatter.address().port;
  const base = mkdtempSync(join(tmpdir(), "f26-busy-"));
  writeFileSync(join(base, "grants.json"), `${JSON.stringify({ tenants: {} }, null, 2)}\n`);
  const envs = childEnv({ ...BASE,
    ports: { ...BASE.ports, client: PORT },
    paths: { ...BASE.paths, base, grants: join(base, "grants.json"), denylist: join(base, "denylist") },
    tokenSecret: "t".repeat(32) });
  const child = spawn(process.execPath, [join(REPO, "mcp-server", "http-server-client.mjs")],
    { env: { PATH: process.env.PATH, HOME: base, ...envs.client }, stdio: ["ignore", "pipe", "pipe"] });
  let out = "";
  child.stdout.on("data", (d) => { out += d; });
  child.stderr.on("data", (d) => { out += d; });
  try {
    const code = await Promise.race([
      new Promise((r) => child.once("exit", (c) => r(c))),
      new Promise((r) => setTimeout(() => r("still-up"), 8000)),
    ]);
    assert.notEqual(code, "still-up", `the door bound a port already held by another listener:\n${out}`);
    // exitCode is the fact the summary now reads, and it is set the moment the process is reaped.
    assert.notEqual(child.exitCode, null,
      "exitCode must be non-null once the door has exited — this is the value the NOT RUNNING branch reads");
    assert.match(out, /already in use|EADDRINUSE/i,
      `the door must say WHY it could not start, since the summary points a reader at its output:\n${out}`);
  } finally {
    try { process.kill(child.pid); } catch { /* already gone */ }
    await new Promise((r) => squatter.close(r));
  }
});

test("2176-F26 the client door is in the background set, which is the parity this is measured against", () => {
  // If the door ever left SERVER_INSTALL_SET, the arms above would be enforcing parity with nothing.
  assert.ok(BACKGROUND_UNITS.includes("clearotron-client-mcp.service"),
    "the door left the install set, so 'the same set as --background' no longer means what these arms assume");
});

// ── 2191 F15 + F11 · THE DOOR THAT WAS STARTED AND NEVER CHECKED ────────────────────────────────────
//
// `--background` ran `enable --now` over FOUR units and then verified a hardcoded pair. So a client door
// crash-looping against a held port got no ✗, was never named, and the run printed its success block and
// exited 0 over a product that was two-thirds up. On the foreground path the same input was worse: the
// collision was found AFTER the other two doors had bound, so the run fatalled mid-flight, tore down
// what it had started, and did not exit — rc=124 at 120s and at 300s.

const START_SRC = readFileSync(join(REPO, "bin", "start.mjs"), "utf8");

test("2191-F15 the background health check covers every unit the flag installs", () => {
  // DERIVED, NOT LISTED. The defect was a list kept beside the set it was supposed to cover; an arm that
  // names the four units here would be the same mistake one layer out, green until a fifth is added.
  assert.ok(BACKGROUND_UNITS.length >= 3, `only ${BACKGROUND_UNITS.length} unit(s) — this arm would be free`);
  const at = START_SRC.indexOf("STARTED IS NOT RUNNING");
  assert.notEqual(at, -1, "anchor missing: the post-enable verification block moved — re-aim this arm");
  // TO THE END OF THE BLOCK, not a byte count: a fixed slice measures how long the comments above the
  // code are, which is not the property under test. An earlier draft of this arm used one and failed on
  // a tree that satisfies the criterion.
  const loop = START_SRC.slice(at, START_SRC.indexOf("── 5. start them", at));
  assert.match(loop, /for \(const u of BACKGROUND_UNITS\)/,
    "the check must iterate the install set itself. It iterated a hardcoded pair while `enable --now` "
    + "started four, which is how a crash-looping client door read as a clean start");
  // AND THE FAILURE NAMES THE UNIT, because the operator's next command is about one of them.
  assert.match(loop, /sickUnits\.join/, "the refusal must name which units did not come up");
});

test("2191-F15 a oneshot is judged by being enabled, not by still running", () => {
  // The old comment justified the gap with "the oneshot worker ... judged by being enabled". That was
  // stale — clearotron-worker.service is `runner.mjs --watch`, Type=simple — but the DISTINCTION is real
  // and must survive, or adding a genuine oneshot later would report it broken for exiting.
  const at2 = START_SRC.indexOf("STARTED IS NOT RUNNING");
  const loop = START_SRC.slice(at2, START_SRC.indexOf("── 5. start them", at2));
  assert.match(loop, /type === "oneshot"/, "the Type distinction must be kept");
  assert.match(loop, /UnitFileState/, "and a oneshot is judged by being enabled");

  // THE CLAIM ABOUT TODAY'S UNITS, checked against the unit files rather than remembered: every unit in
  // the install set is long-running right now, which is why all four are health-checked.
  for (const u of BACKGROUND_UNITS) {
    const text = readFileSync(join(REPO, "driver", "systemd", u), "utf8");
    assert.match(text, /^Type=simple$/m, `${u} is no longer Type=simple — re-read the health check's assumptions`);
  }
});

test("2191-F11 the foreground port pre-check covers ALL THREE doors, before anything binds", () => {
  const probeLoop = START_SRC.slice(START_SRC.indexOf("for (const [what, port, portVar] of"));
  const head = probeLoop.slice(0, 400);
  for (const v of ["PORTAL_SERVICE_PORT", "TRADEMARK_MCP_HTTP_PORT", "CLIENT_MCP_HTTP_PORT"])
    assert.ok(head.includes(v),
      `${v} is not in the pre-bind probe. The client door's port is resolved beside the other two and was `
      + "left out of the loop written for exactly this principle, so a held port was found only after the "
      + "other doors had bound — a fatal mid-flight, a teardown, and no exit");

  // BEFORE THE FIRST WRITE, which is the whole point of the check: `markStateWritten` is what divides
  // "refuses with nothing to clean up" from "refuses over a changed box".
  assert.ok(START_SRC.indexOf("for (const [what, port, portVar] of") < START_SRC.indexOf("markStateWritten()"),
    "the probe must run before the run starts changing the box");
});

// ── 2191 · A REFRESH RESTARTS EVERY UNIT IT REPLACED ────────────────────────────────────────────────
//
// `enable --now` on an ALREADY-ACTIVE unit is a no-op, so a `--background` refresh over an updated
// checkout leaves the old process running the old files. The restart loop that exists for exactly that
// named a hardcoded PAIR — the same pair the health check named, three lines below it — with the same
// stale justification about "the oneshot and its triggers". There is no oneshot in the set.
//
// So a refresh restarted the portal and the engine door onto new code and left the worker and the
// client door on the old, while the health check reported all four up. Fixing the check without fixing
// this made it worse: a more confident report over an unchanged restart. Measured by an operator on the
// test box — `enable --now` left MainPID unchanged.

test("2191 a refresh restarts every long-running unit in the install set", () => {
  // DRIVEN, not source-matched: the decision is a pure function precisely so it can be, and a grep for
  // the loop would go green on one that iterates the right list and restarts nothing.
  const all = unitsToRestartOnRefresh(BACKGROUND_UNITS, () => "simple");
  assert.deepEqual([...all].sort(), [...BACKGROUND_UNITS].sort(),
    "every unit is Type=simple today, so a refresh must restart all of them — the pair this replaced "
    + "left the worker and the client door running old code");
});

test("2191 a oneshot is still excluded, which is what the old comment was right about", () => {
  // The justification was stale, not wrong in principle: restarting a oneshot re-runs it, and it picks
  // up new files on its next activation anyway. Keeping the distinction means adding one later does not
  // silently start getting restarted.
  const withOneshot = unitsToRestartOnRefresh(BACKGROUND_UNITS, (u) => (u.includes("worker") ? "oneshot" : "simple"));
  assert.ok(!withOneshot.includes("clearotron-worker.service"), "a oneshot must not be restarted");
  assert.equal(withOneshot.length, BACKGROUND_UNITS.length - 1, "and nothing else is dropped with it");
});

test("2191 the restart loop uses that decision rather than a list of its own", () => {
  const at = START_SRC.indexOf("if (backgroundRefresh) for (const u of");
  assert.notEqual(at, -1, "anchor missing: the refresh restart loop moved — re-aim this arm");
  assert.match(START_SRC.slice(at, at + 200), /unitsToRestartOnRefresh\(BACKGROUND_UNITS/,
    "a second list here would drift from the set silently — each copy looks right on its own, which is "
    + "how the pair this replaced survived beside a health check that had already been fixed");
});

// ── 2191 · NRestarts IS A LIFETIME COUNTER, NOT A VERDICT ───────────────────────────────────────────
//
// The health verdict required NRestarts === "0". That counter counts every restart since the unit was
// loaded, and systemd's OWN auto-restart is what increments it — an explicit `systemctl restart` and
// `reset-failed` both clear it (measured on systemd 255; an earlier note here said only the second did,
// and that was wrong). So a unit that
// crash-looped once, was fixed, and has served ever since carries a permanent non-zero count, and
// `start --background` printed "✗ … is NOT running (active/running, restarts 15)" and exited 1 FOREVER
// on a healthy box. Measured by an operator: door up, serving, MainPID unchanged, count 15.
//
// The condition predates the F15 change; that change extended it from two units to four and so doubled
// what it could block. It would have shipped in the publish.

test("2191 a RECOVERED unit is healthy — a lifetime restart count is history, not a fault", () => {
  const v = unitHealthVerdict({ activeState: "active", subState: "running", nRestarts: "15" });
  assert.equal(v.ok, true,
    "active/running IS up. Requiring a zero lifetime counter fails a box that recovered, permanently, "
    + "and no restart clears it");
  assert.equal(v.restarts, 15, "the count still travels, because a unit that has restarted is worth an eye");
});

test("2191 and a unit actually looping is still caught, without the counter", () => {
  // The counter was never what caught a real loop: a looping unit reads activating/auto-restart and
  // never active/running. Without this arm the fix above could be satisfied by a verdict that passes
  // everything.
  assert.equal(unitHealthVerdict({ activeState: "activating", subState: "auto-restart", nRestarts: "40" }).ok, false);
  assert.equal(unitHealthVerdict({ activeState: "inactive", subState: "dead", nRestarts: "0" }).ok, false,
    "and a unit that never started is not up either, whatever its counter says");
});

test("2191 a oneshot is judged by being enabled, and its counter is irrelevant there too", () => {
  assert.equal(unitHealthVerdict({ type: "oneshot", unitFileState: "enabled", nRestarts: "9" }).ok, true);
  assert.equal(unitHealthVerdict({ type: "oneshot", unitFileState: "disabled", activeState: "active", subState: "running" }).ok, false,
    "a oneshot that happens to be running is not the question — being enabled is");
});

// ── 2191 · ONE DENYLIST FOR BOTH DOORS ──────────────────────────────────────────────────────────────
//
// The client door was composed with the DEFAULT unconditionally, while every other child inherited the
// operator's TRADEMARK_MCP_TOKEN_DENYLIST. So where an operator had placed the list themselves, the
// staff door honoured it and the client door did not — and account keys live at the client door.

test("2191 both doors get the operator's denylist when one is set", () => {
  const base = { ports: { portal: 1, mcp: 2, client: 3 },
    paths: { base: "/b", pool: "/b/pool", grants: "/b/g.json", configStore: "/b/c", audit: "/b/a", recipes: "/b/r" },
    user: "a@b", staffDomains: "b", portalSecret: "s", tokenSecret: "t", opsToken: "o" };
  const e = childEnv({ ...base, env: { TRADEMARK_MCP_TOKEN_DENYLIST: "/srv/operator-chosen" } });
  assert.equal(e.client.TRADEMARK_MCP_TOKEN_DENYLIST, "/srv/operator-chosen",
    "the client door ignored the operator's variable entirely, so revoking by the documented route "
    + "revoked at the staff door and silently did nothing at the door account keys use");
  // The staff door INHERITS rather than being composed, which is the same value by a different route —
  // asserting it is not overridden is the property that matters.
  assert.ok(!e.mcp?.TRADEMARK_MCP_TOKEN_DENYLIST || e.mcp.TRADEMARK_MCP_TOKEN_DENYLIST === "/srv/operator-chosen",
    "the staff door must not be given a different one");

  // AND UNSET: the fallback is the documented default, or this fix would have traded one mismatch for
  // a door with no denylist at all. That half is what the previous arm was missing.
  const none = childEnv({ ...base, env: {} });
  assert.match(none.client.TRADEMARK_MCP_TOKEN_DENYLIST, /\.config\/clearotron\/token-denylist$/,
    "with nothing set, the client door still gets the documented default");
});
