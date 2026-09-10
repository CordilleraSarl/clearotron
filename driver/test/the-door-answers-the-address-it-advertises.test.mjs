// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// ── — THE DOOR REFUSED THE ADDRESS THE PRODUCT HANDS OUT ─────────────────
//
// `connect` wrote an allow-list of loopback only, while the same flow serves assistants the public
// address from CLEAROTRON_CLIENT_MCP_URL. Through a tunnel the Host header is the public name, so the door
// answered `Invalid Host header` to the very address the product advertises. The owner hit it on his
// first real connection and worked around it by hand.
//
// WHAT MAKES IT WORSE THAN A MISCONFIGURATION: auth was already VALID when it fired. What an operator
// sees is a working key "failing", with no path forward and nothing naming the cause — the door is up,
// the key is right, and every request is turned away.
//
// BREAK MATRIX:
//   · the public host reaches the allow-list        → break: drop it, arm 1 red
//   · bare AND :443, because both arrive            → break: send one, arm 1 red
//   · an explicit port is honoured as itself        → break: hard-code 443, arm 2 red
//   · loopback is never dropped                     → break: replace it, arm 3 red
//   · a malformed URL does not break the install    → break: throw, arm 4 red
//   · the plan writes what the helper derives       → break: rewrite the literal, arm 5 red
import { test } from "node:test";
import assert from "node:assert/strict";
import { allowedHosts, enablePlan } from "../../shared/client-door.mjs";
import { nonEmpty } from "../../shared/vacuous-pass.mjs";

const list = (...a) => allowedHosts(...a).split(",");

test("the public hostname reaches the allow-list, bare and with :443", () => {
  // THE DEFECT, REPRODUCED: loopback only is what the plan used to write, and it is what a tunnel's
  // Host header never matches.
  const without = list(8848);
  assert.deepEqual(without, ["127.0.0.1:8848", "localhost:8848"],
    "the fixture no longer reproduces the loopback-only list this issue is about");

  const withPublic = list(8848, { CLEAROTRON_CLIENT_MCP_URL: "https://clearotron.example.com/mcp" });
  assert.ok(withPublic.includes("clearotron.example.com"),
    "the bare public name is not allowed — this is the header a TLS client on the default port sends");
  assert.ok(withPublic.includes("clearotron.example.com:443"),
    "the public name with :443 is not allowed — some clients send the port and both arrive here");
});

test("an explicit port is honoured as itself, not rewritten to 443", () => {
  // Somebody publishing on :8443 sends :8443. Hard-coding 443 would fix the common case and leave the
  // uncommon one with exactly the defect this issue is about.
  const l = list(8848, { CLEAROTRON_CLIENT_MCP_URL: "https://clearotron.example.com:8443/mcp" });
  assert.ok(l.includes("clearotron.example.com:8443"), "the published port is not in the allow-list");
  assert.ok(!l.includes("clearotron.example.com:443"), "a port nobody published was allowed instead");
});

test("loopback is never dropped for the public name", () => {
  // A local install has no public name at all, and the portal and health probes reach the door on
  // 127.0.0.1. A plan that swapped loopback for the public host would fix a tunnel by breaking the
  // machine the door runs on.
  for (const url of nonEmpty([
    "https://clearotron.example.com/mcp",
    "https://clearotron.example.com:8443/mcp",
    "http://box.local:8080/mcp",
  ], "the public URLs driven here")) {
    const l = list(8848, { CLEAROTRON_CLIENT_MCP_URL: url });
    assert.ok(l.includes("127.0.0.1:8848"), `loopback vanished for ${url}`);
    assert.ok(l.includes("localhost:8848"), `localhost vanished for ${url}`);
  }
});

test("a malformed or absent URL leaves a working local door", () => {
  // This runs on the install path. An unparseable value in one variable must not take `connect` down —
  // a door that runs and turns one address away is recoverable; a connect that dies on a typo is not.
  for (const bad of ["not a url", "://", "", "   ", undefined]) {
    const l = list(8848, { CLEAROTRON_CLIENT_MCP_URL: bad });
    assert.deepEqual(l, ["127.0.0.1:8848", "localhost:8848"], `a bad URL (${JSON.stringify(bad)}) changed the list`);
  }
  assert.deepEqual(list(8848, {}), ["127.0.0.1:8848", "localhost:8848"]);
});

test("no duplicate entries, whatever the URL says", () => {
  // A public name that IS loopback is a real local-tunnel shape, and a repeated host in the list is a
  // config a reader has to squint at to trust.
  const l = list(8848, { CLEAROTRON_CLIENT_MCP_URL: "http://localhost:8848/mcp" });
  assert.equal(new Set(l).size, l.length, `the allow-list repeats an entry: ${l.join(",")}`);
});

// ---- the JOIN, which is where tonight's other seam lived --------------------------------------

test("the PLAN writes what the derivation produces — driven, not assumed", () => {
  // A helper that is right and a plan that ignores it is the shape this repo met twice in one night:
  // two halves each internally consistent, and the defect living only in the join. So this drives
  // enablePlan itself rather than asserting that it calls the function.
  const base = {
    env: { TRADEMARK_MCP_TOKEN_SECRET: "x", CLEAROTRON_CLIENT_MCP_URL: "https://clearotron.example.com/mcp" },
    address: null, identity: null, issuesKey: false, checkoutDir: "/opt/clearotron",
    unitEnvHasSecret: true, accessFile: "/var/lib/clearotron/grants.json",
  };
  const plan = enablePlan(base);
  assert.ok(plan.possible, `the reference plan refused, so this arm compares nothing: ${JSON.stringify(plan.blockers)}`);

  const written = String(plan.settings.CLIENT_MCP_ALLOWED_HOSTS ?? "");
  assert.ok(written.includes("clearotron.example.com"),
    "the plan still writes a loopback-only allow-list — the derivation exists and the door never sees it");
  assert.ok(written.includes("clearotron.example.com:443"));
  assert.ok(written.includes("127.0.0.1:"), "the plan dropped loopback");

  // And the two agree EXACTLY: the plan is not composing a second list of its own that happens to
  // overlap. The port it resolved is the port the list must name.
  const port = plan.settings.CLIENT_MCP_HTTP_PORT;
  assert.equal(written, allowedHosts(port, base.env),
    "the plan's allow-list and the derivation disagree — one of them is a second authority");

  // WITHOUT the public URL, the plan is byte-for-byte what it always wrote. A local install must not
  // change shape because a tunnel-shaped feature landed.
  const localOnly = enablePlan({ ...base, env: { TRADEMARK_MCP_TOKEN_SECRET: "x" } });
  assert.ok(localOnly.possible, JSON.stringify(localOnly.blockers));
  assert.equal(localOnly.settings.CLIENT_MCP_ALLOWED_HOSTS,
    `127.0.0.1:${localOnly.settings.CLIENT_MCP_HTTP_PORT},localhost:${localOnly.settings.CLIENT_MCP_HTTP_PORT}`,
    "a local install's allow-list changed shape");
});

// ── TWO DOORS, ONE SHAPE, AND ONLY ONE OF THEM WAS WRITTEN ──────────────────────
//
// `CLIENT_MCP_ALLOWED_HOSTS` and `TRADEMARK_MCP_ALLOWED_HOSTS` are the same value one door apart: the
// `host:port` list that arms DNS-rebinding protection. Both doors refuse to start without theirs, in the
// same sentence. The client door's was composed by the installer; the engine door's was composed by
// NOTHING on a hosted install — `bin/start.mjs` injects one into its own children's environment, which
// no systemd unit inherits. So the documented install asked a reader for a value while writing the
// identical one beside it.
//
// DRIVEN AT THE INSTALLER'S DOOR, never read off the source, and that is this issue's own instruction:
// the `PORTAL_MCP_URL` repair's first cut passed a hand-made two-line env and failed the shipped
// template's empty row. What is exercised here is `writeInstallEnv` writing a real file.
//
// BREAK MATRIX:
//   · the engine door's list is written at all      → break: drop it from the loop, arm 1 red
//   · it is derived from the ENGINE door's port      → break: read the client's, arm 1 red
//   · it carries the ENGINE door's public address    → break: read CLEAROTRON_CLIENT_MCP_URL, arm 1 red
//   · it FOLLOWS the port when the port moves        → break: make it add-only, arm 2 red
//   · an operator's own host survives the follow     → break: overwrite the list, arm 2 red
//   · one author composes both                       → break: give the engine door its own, arm 3 red
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DOOR_ALLOW_LISTS, ENGINE_DOOR_URL_ENV, CLIENT_DOOR_URL_ENV } from "../../shared/client-door.mjs";
import { writeInstallEnv } from "../systemd/render-units.mjs";

/** A greenfield hosted install's env file, with the preconditions `enablePlan` refuses without.
 *  PORTS ARE HIGH AND OURS. The shipped defaults (18790/18811/18802) reach a live install on a
 *  developer box — a drive on this file's subject has hit the owner's production portal before. */
function scratchInstall({ enginePort = 29790, clientPort = 29811 } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "door-allow-"));
  const access = join(dir, "grants.json");
  writeFileSync(access, "{}\n");
  const envFile = join(dir, ".env");
  writeFileSync(envFile, [
    "CLEAROTRON_REPORTS_DIR=/srv/example/pool",
    "CLEAROTRON_WORK_DIR=/srv/example/workspace",
    "CLEAROTRON_QUEUE_DIR=/srv/example/queue",
    `TRADEMARK_MCP_HTTP_PORT=${enginePort}`,
    `CLIENT_MCP_HTTP_PORT=${clientPort}`,
    "PORTAL_SERVICE_PORT=29802",
    `${ENGINE_DOOR_URL_ENV}=https://engine.example.org/mcp`,
    `${CLIENT_DOOR_URL_ENV}=https://client.example.org/mcp`,
    `CLEAROTRON_ACCESS_FILE=${access}`,
    "",
  ].join("\n"));
  return { dir, envFile };
}

const valueOf = (envFile, name) => {
  const m = new RegExp(`^${name}=(.*)$`, "m").exec(readFileSync(envFile, "utf8"));
  return m ? m[1].trim() : null;
};

test("the engine door's allow-list is WRITTEN by the install, from its own port and its own address", async () => {
  const { envFile } = scratchInstall();
  // The defect, reproduced first: nothing on disk for the engine door before the installer runs.
  assert.equal(valueOf(envFile, "TRADEMARK_MCP_ALLOWED_HOSTS"), null,
    "the fixture already carries the value — this arm would pass over the defect it is named for");
  await writeInstallEnv(envFile);

  const engine = valueOf(envFile, "TRADEMARK_MCP_ALLOWED_HOSTS");
  assert.ok(engine, "the engine door's allow-list is still written by nothing — the door refuses to start without it");
  const hosts = engine.split(",");
  // ITS OWN PORT. 29790, not the client door's 29811 — a re-implementation that reads the wrong door's
  // port produces a list that looks right and turns every request away.
  assert.ok(hosts.includes("127.0.0.1:29790"), `the engine door's list does not name the port it binds: ${engine}`);
  assert.ok(hosts.includes("localhost:29790"), `loopback is incomplete: ${engine}`);
  assert.ok(!hosts.some((h) => h.endsWith(":29811")), `the engine door's list names the CLIENT door's port: ${engine}`);
  // ITS OWN PUBLIC ADDRESS, bare and with :443, for the reason arm 1 of this file gives.
  assert.ok(hosts.includes("engine.example.org"), `the engine door's public name is absent: ${engine}`);
  assert.ok(hosts.includes("engine.example.org:443"), `the engine door's public name has no :443 form: ${engine}`);
  assert.ok(!hosts.includes("client.example.org"), `the engine door's list carries the CLIENT door's address: ${engine}`);

  // AND THE CLIENT DOOR IS UNTOUCHED BY THE CHANGE — the arm that would catch a fix that fixed one door
  // by breaking the other.
  const client = valueOf(envFile, "CLIENT_MCP_ALLOWED_HOSTS");
  assert.ok(client, "the client door's allow-list stopped being written");
  assert.ok(client.split(",").includes("127.0.0.1:29811"), `the client door's list lost its own port: ${client}`);
  assert.ok(client.split(",").includes("client.example.org"), `the client door's list lost its own address: ${client}`);
});

test("PLANTED AGAINST THE PORT, not the value — and an operator's own host survives it", async () => {
  // This issue's own instruction, and the reason for it: an arm that pins the composed string passes a
  // re-implementation that ignores the operator's port. So the plant MOVES the port and asserts the list
  // follows, which no hard-coded literal can satisfy.
  const { envFile } = scratchInstall({ enginePort: 29790 });
  await writeInstallEnv(envFile);
  assert.ok(valueOf(envFile, "TRADEMARK_MCP_ALLOWED_HOSTS").includes("127.0.0.1:29790"), "the first apply did not derive");

  // The operator moves the port by hand and adds a host of their own — the two edits the report
  // was filed for, on the door that had no writer at all until now.
  let body = readFileSync(envFile, "utf8")
    .replace(/^TRADEMARK_MCP_HTTP_PORT=.*$/m, "TRADEMARK_MCP_HTTP_PORT=29795")
    .replace(/^(TRADEMARK_MCP_ALLOWED_HOSTS=.*)$/m, "$1,my-own-proxy.internal:8443");
  writeFileSync(envFile, body);
  await writeInstallEnv(envFile);

  const after = valueOf(envFile, "TRADEMARK_MCP_ALLOWED_HOSTS").split(",");
  assert.ok(after.includes("127.0.0.1:29795"), `the list did not follow the port: ${after.join(",")}`);
  assert.ok(!after.includes("127.0.0.1:29790"), `the stale loopback entry survived: ${after.join(",")}`);
  // THE HALF THAT IS NOT THE INSTALLER'S. A repair about a port that deletes a hostname somebody added
  // by hand is a worse outcome than the stale entry it fixed.
  assert.ok(after.includes("my-own-proxy.internal:8443"),
    `the operator's own host was deleted by a repair about a port: ${after.join(",")}`);
});

test("ONE AUTHOR composes both doors — the pair is data, and the address's name is a parameter", () => {
  // The asymmetry existed because two places composed `host:port` independently. A fix that only wrote
  // the missing value would have left the shape that produced it, so the arm is about the shape.
  const doors = DOOR_ALLOW_LISTS.map((d) => d.door);
  assert.ok(doors.includes("client") && doors.includes("engine"),
    `both doors must be in the one table, got: ${doors.join(",")}`);
  nonEmpty(DOOR_ALLOW_LISTS, "the door table is empty — every arm keyed on it would pass over nothing");
  for (const d of DOOR_ALLOW_LISTS)
    for (const k of ["port", "hosts", "url"])
      assert.ok(String(d[k] ?? "").trim(), `the ${d.door} door's row names no ${k}`);
  // The two rows must not share a variable, which is the specific way one door's fix breaks the other.
  const [a, b] = DOOR_ALLOW_LISTS;
  for (const k of ["port", "hosts", "url"])
    assert.notEqual(a[k], b[k], `both doors claim the same ${k} variable (${a[k]}) — one of them is wrong`);
  // DRIVEN, so this is not a shape assertion about a table nobody calls: the same helper composes a
  // different list for each door's address, which is the whole of what "one author" buys.
  const eng = allowedHosts(1234, { [ENGINE_DOOR_URL_ENV]: "https://e.example/mcp" }, { urlName: ENGINE_DOOR_URL_ENV });
  const cli = allowedHosts(1234, { [CLIENT_DOOR_URL_ENV]: "https://c.example/mcp" }, { urlName: CLIENT_DOOR_URL_ENV });
  assert.ok(eng.includes("e.example") && !eng.includes("c.example"), `the engine door read the wrong address: ${eng}`);
  assert.ok(cli.includes("c.example") && !cli.includes("e.example"), `the client door read the wrong address: ${cli}`);
});
