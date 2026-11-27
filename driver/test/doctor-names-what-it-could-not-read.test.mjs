// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// DOCTOR NAMES WHAT IT COULD NOT READ, AND NEVER PRINTS WHAT THE MACHINE SAID.
//
// Three cases from a review of doctor's output (design, 2026-11-27), each run from a clean shell in a temporary home
// with no engine program and no paid probe:
//
//   - A settings file that is there and cannot be read was ticked, every setting in it then read as unset ("no AI is
//     chosen and no register is chosen"), and doctor exited 0. It is a failed check now: the file is named, nothing in
//     it is reported absent, and a setting this command's own environment carries is still read.
//   - A custom-instructions folder that cannot be read reads as a failed check that names the setting, whether the
//     environment or the settings file names it.
//   - A service that does not answer is named by its address, never by the connection's own error, and an address is
//     shown without a user, a password or a query.
//
// THE CONTROLS: the same home with the file readable is ticked and says nothing about an unread file; the setting the
// environment carries is reported from the environment. A mode-000 file is readable by root and the mode means nothing
// on Windows, so those arms do not run there; they are skipped by name rather than passed.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { createServer as createHttpServer } from "node:http";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { handRunEnv } from "./drive-env.mjs";
import { shownAddress } from "../../shared/shown-address.mjs";
import { triggerLaneVerdict, laneProbeUrl, HOSTED } from "../../shared/trigger-lane.mjs";
import { clientDoorReachability, carriesUserOrPassword } from "../../shared/client-door.mjs";
import { billingLine, billingUnresolved } from "../../bin/onboard.mjs";

const ONBOARD = fileURLToPath(new URL("../../bin/onboard.mjs", import.meta.url));
const WINDOWS = process.platform === "win32";
const MODES_MEAN_NOTHING = WINDOWS || process.getuid?.() === 0
  ? "file modes do not stop this user reading a file (root, or Windows)" : false;

const NODE_BIN = (() => {
  const d = mkdtempSync(join(tmpdir(), "could-not-read-node-"));
  symlinkSync(process.execPath, join(d, WINDOWS ? "node.exe" : "node"));
  return d;
})();
const SEARCHED = [NODE_BIN, ...(WINDOWS ? [process.env.PATH] : ["/usr/bin", "/bin"])].join(delimiter);

/** A home as setup leaves it, with its settings file; `instructions` adds a custom-instructions folder. */
function setUpHome({ fileLines = [] } = {}) {
  const home = mkdtempSync(join(tmpdir(), "could-not-read-"));
  const base = join(home, "trademark");
  for (const d of ["pool", "workspace", "queue", "outbox", "locks", "config/skills", "config/profiles"]) mkdirSync(join(base, d), { recursive: true });
  mkdirSync(join(home, ".config", "clearotron"), { recursive: true });
  const envFile = join(home, ".config", "clearotron", ".env");
  writeFileSync(envFile, [
    `CLEAROTRON_REPORTS_DIR=${join(base, "pool")}`,
    `CLEAROTRON_WORK_DIR=${join(base, "workspace")}`,
    `CLEAROTRON_QUEUE_DIR=${join(base, "queue")}`,
    `CLEAROTRON_CUSTOMERS_DIR=${join(base, "config", "profiles")}`,
    `PROFILE_REPO_ROOT=${join(base, "config")}`,
    "CLEAROTRON_AI=anthropic-agent",
    ...fileLines.map((l) => l.replaceAll("<home>", home)),
  ].join("\n") + "\n");
  return { home, base, envFile };
}

function doctor(home, env = {}) {
  try {
    const out = execFileSync(process.execPath, [ONBOARD, "--check"], {
      encoding: "utf8", stdio: "pipe", timeout: 120_000,
      env: handRunEnv({ HOME: home, USERPROFILE: home, PATH: SEARCHED, CLEAROTRON_DOCTOR_ASSUME_PINNED: "1",
        ...(WINDOWS ? { SystemRoot: process.env.SystemRoot } : {}), ...env }, {}),
    });
    return { out, code: 0 };
  } catch (e) { return { out: `${e.stdout ?? ""}${e.stderr ?? ""}`, code: e.status }; }
}

/** doctor, without blocking this process: for an arm whose door runs in this process and must answer while doctor asks. */
function doctorAsync(home, env = {}) {
  return new Promise((resolve) => {
    execFile(process.execPath, [ONBOARD, "--check"], {
      encoding: "utf8", timeout: 120_000,
      env: handRunEnv({ HOME: home, USERPROFILE: home, PATH: SEARCHED, CLEAROTRON_DOCTOR_ASSUME_PINNED: "1",
        ...(WINDOWS ? { SystemRoot: process.env.SystemRoot } : {}), ...env }, {}),
    }, (e, stdout, stderr) => resolve({ out: `${stdout ?? ""}${stderr ?? ""}`, code: e ? e.code : 0 }));
  });
}

const flat = (s) => s.replace(/\s+/g, " ");
const RAW = /EACCES|EPERM|ENOENT|ECONNREFUSED|TypeError|fetch failed|permission denied/i;
const UNREAD = "~/.config/clearotron/.env could not be read, so none of its settings were read. Make it readable by the "
  + "user the services run as, then run";

test("an unreadable settings file is a failed check that names the file and reports nothing in it as unset", { skip: MODES_MEAN_NOTHING }, () => {
  const { home, envFile } = setUpHome();
  try {
    chmodSync(envFile, 0);
    const { out, code } = doctor(home);
    assert.equal(code, 1, `an unreadable settings file exited ${code}:\n${out}`);
    assert.ok(flat(out).includes(`✗ ${UNREAD}`), `the failed check does not name the file:\n${out}`);
    assert.ok(out.split("\n").some((l) => flat(l).trim().startsWith(UNREAD)), `the opening does not lead with it:\n${out}`);
    for (const absent of [/is not set/, /is unset/, /no AI is chosen/, /no register is (chosen|selected)/, /none configured/])
      assert.doesNotMatch(out, absent, `a setting in the unread file was reported absent (${absent}):\n${out}`);
    assert.doesNotMatch(out, RAW, `the machine's own words reached doctor's output:\n${out}`);
  } finally { chmodSync(join(home, ".config", "clearotron", ".env"), 0o600); rmSync(home, { recursive: true, force: true }); }
});

test("the control: what this command's environment carries is still read when the settings file is not", { skip: MODES_MEAN_NOTHING }, () => {
  const { home, base, envFile } = setUpHome();
  try {
    chmodSync(envFile, 0);
    const store = join(base, "config", "profiles");
    const { out } = doctor(home, { CLEAROTRON_AI: "anthropic-agent", CLEAROTRON_CUSTOMERS_DIR: store });
    assert.ok(flat(out).includes(UNREAD), `the unread file is not named:\n${out}`);
    assert.match(out, /✓ anthropic-agent \(environment\)/, `the AI the environment chooses is not reported:\n${out}`);
    assert.ok(out.includes(`✓ CLEAROTRON_CUSTOMERS_DIR=${store} (environment)`), `the store the environment names is not reported:\n${out}`);
  } finally { chmodSync(join(home, ".config", "clearotron", ".env"), 0o600); rmSync(home, { recursive: true, force: true }); }
});

test("the control: the same settings file, readable, is ticked and nothing is said about an unread file", () => {
  const { home } = setUpHome();
  try {
    const { out } = doctor(home);
    assert.match(out, /✓ ~[\\/]\.config[\\/]clearotron[\\/]\.env/, `the readable file is not ticked by name:\n${out}`);
    assert.doesNotMatch(out, /could not be read, so none of its settings were read/, `a readable file was called unreadable:\n${out}`);
    assert.match(out, /CLEAROTRON_AI|anthropic-agent/, `the readable file's settings were not read:\n${out}`);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test("with units, an unreadable settings file of this command's own leaves the services' answers standing", { skip: MODES_MEAN_NOTHING }, async () => {
  // The units read their own file (`%h/.env`), never this command's, so only this command's own lines are affected.
  const { BACKGROUND_UNITS } = await import(pathToFileURL(fileURLToPath(new URL("../../bin/start.mjs", import.meta.url))).href);
  const { home, base, envFile } = setUpHome();
  const unitDir = join(home, ".config", "systemd", "user");
  mkdirSync(unitDir, { recursive: true });
  for (const u of BACKGROUND_UNITS) writeFileSync(join(unitDir, u), "[Service]\nEnvironmentFile=%h/.env\nExecStart=/bin/true\n");
  const store = join(base, "config", "profiles");
  const folder = join(home, "services-instructions");
  mkdirSync(folder);
  writeFileSync(join(home, ".env"), `CLEAROTRON_CUSTOMERS_DIR=${store}\nCLEAROTRON_INSTRUCTIONS_DIR=${folder}\nCLEAROTRON_AI=anthropic-agent\n`);
  try {
    chmodSync(envFile, 0);
    const { out } = doctor(home);
    assert.ok(flat(out).includes(`✗ ${UNREAD}`), `this command's unreadable file is not named:\n${out}`);
    assert.ok(out.includes(`✓ the services resolve profiles from ${store}`), `the services' store went with this command's file:\n${out}`);
    assert.ok(out.includes(`the services read custom instructions this process does not: ${folder}`),
      `the services' instructions folder went with this command's file:\n${out}`);
  } finally { chmodSync(envFile, 0o600); rmSync(home, { recursive: true, force: true }); }
});

for (const where of ["the settings file", "the environment"]) {
  test(`an unreadable custom-instructions folder named in ${where} is a failed check that names the setting`, { skip: MODES_MEAN_NOTHING }, () => {
    const { home } = setUpHome({ fileLines: where === "the settings file" ? ["CLEAROTRON_INSTRUCTIONS_DIR=<home>/instructions"] : [] });
    const folder = join(home, "instructions");
    mkdirSync(folder);
    try {
      chmodSync(folder, 0);
      const { out, code } = doctor(home, where === "the environment" ? { CLEAROTRON_INSTRUCTIONS_DIR: folder } : {});
      assert.equal(code, 1, `an unreadable instructions folder exited ${code}:\n${out}`);
      assert.match(out, /✗ the custom instructions could not be read\n\s*· CLEAROTRON_INSTRUCTIONS_DIR names a folder this user cannot read\./,
        `the failed check does not name the setting:\n${out}`);
      assert.doesNotMatch(out, /none configured/, `a folder that could not be read was reported as none:\n${out}`);
      assert.doesNotMatch(out, RAW, `the machine's own words reached doctor's output:\n${out}`);
    } finally { chmodSync(folder, 0o700); rmSync(home, { recursive: true, force: true }); }
  });
}

/** A loopback port nothing listens on: bound, then released. */
async function closedPort() {
  const srv = createServer();
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  const { port } = srv.address();
  await new Promise((r) => srv.close(r));
  return port;
}

test("a service that does not answer is named by its address, without the connection's error", async () => {
  // A PLAIN ADDRESS ON A PORT NOTHING LISTENS ON, so the probe reaches the port and is refused there. (An address that
  // carries a user and password is refused by fetch before it connects, so it cannot exercise this; see the next arm.)
  const port = await closedPort();
  const { home } = setUpHome();
  try {
    const { out, code } = doctor(home, {
      PORTAL_MCP_URL: `http://127.0.0.1:${port}`,
      PORTAL_OPS_TOKEN: "an-ops-token-for-this-test",
      CLEAROTRON_CLIENT_MCP_URL: `https://127.0.0.1:${port}/mcp`,
    });
    assert.equal(code, 1, `a client door that does not answer exited ${code}:\n${out}`);
    // The engine door's refused connection is the boot-time observation, said as that, with its address.
    assert.ok(out.includes(`· http://127.0.0.1:${port} is configured and nothing answered there when this was checked.`),
      `the engine door's refused connection does not name its address:\n${out}`);
    assert.ok(out.includes(`✗ https://127.0.0.1:${port}/mcp is configured and DOES NOT ANSWER.`),
      `the client door's failure does not name its address:\n${out}`);
    assert.ok(!out.includes("an-ops-token-for-this-test"), `the ops token reached doctor's output:\n${out}`);
    assert.doesNotMatch(out, RAW, `the machine's own words reached doctor's output:\n${out}`);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test("an address that carries a user, a password or a query is shown without them", async () => {
  const port = await closedPort();
  const { home } = setUpHome();
  try {
    const { out } = doctor(home, {
      PORTAL_MCP_URL: `http://door-user:door-pass@127.0.0.1:${port}?token=door-secret`,
      PORTAL_OPS_TOKEN: "an-ops-token-for-this-test",
      CLEAROTRON_CLIENT_MCP_URL: `https://127.0.0.1:${port}/mcp?key=client-secret`,
    });
    assert.ok(out.includes(`http://127.0.0.1:${port} is configured`), `the engine door's address is not shown at all:\n${out}`);
    assert.ok(out.includes(`https://127.0.0.1:${port}/mcp is configured`), `the client door's address is not shown at all:\n${out}`);
    for (const secret of ["door-user", "door-pass", "door-secret", "client-secret", "an-ops-token-for-this-test"])
      assert.ok(!out.includes(secret), `a credential reached doctor's output (${secret}):\n${out}`);
    assert.doesNotMatch(out, RAW, `the machine's own words reached doctor's output:\n${out}`);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

// An assistant's client refuses an address with a user or a password in it before it connects (the protocol SDK's
// client, measured 2026-11-27), so doctor names the address as the fault, asks nothing of it, and shows none of it.
const CARRIES = "The client connector address includes a username or password. Remove it from the address before "
  + "sharing it with an assistant.";

test("a client connector address with a user or a password in it is the failed check, and none of it is shown", async () => {
  const port = await closedPort();
  const { home } = setUpHome();
  try {
    const { out, code } = doctor(home, { CLEAROTRON_CLIENT_MCP_URL: `https://client-user:client-pass@127.0.0.1:${port}/mcp?key=client-secret` });
    assert.equal(code, 1, `an address an assistant refuses exited ${code}:\n${out}`);
    assert.ok(out.includes(`✗ ${CARRIES}`), `the address is not named as the fault:\n${out}`);
    assert.doesNotMatch(out, /DOES NOT ANSWER|NOBODY ASKED/, `the address was judged as a door rather than as an address:\n${out}`);
    for (const secret of ["client-user", "client-pass", "client-secret", `127.0.0.1:${port}`])
      assert.ok(!out.includes(secret), `the address or what it carries reached doctor's output (${secret}):\n${out}`);
    assert.doesNotMatch(out, RAW, `the machine's own words reached doctor's output:\n${out}`);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test("a user alone, a password alone, or both: the same failure, whatever a probe said, and a plain address is still asked", () => {
  // Judged before the unprobed branch, so an address doctor did not ask fails rather than reading as not yet asked.
  for (const url of ["https://u@mcp.example.com/mcp", "https://:p@mcp.example.com/mcp", "https://u:p@mcp.example.com/mcp", "http://u:p@mcp.example.com/mcp"]) {
    assert.equal(carriesUserOrPassword(url), true, url);
    for (const probe of [null, { ok: true, status: 405 }, { ok: false, error: "ECONNREFUSED" }]) {
      assert.deepEqual(clientDoorReachability({ url, probe }), { state: "fail", message: CARRIES }, `${url} ${JSON.stringify(probe)}`);
    }
  }
  for (const url of ["https://mcp.example.com/mcp", "https://mcp.example.com/mcp?key=xyz", "nope nope", ""]) assert.equal(carriesUserOrPassword(url), false, url);
  // The control: a valid address keeps the ordinary check, so a real outage keeps its own explanation.
  assert.equal(clientDoorReachability({ url: "https://mcp.example.com/mcp", probe: { ok: true, status: 405 } }).state, "pass");
  assert.match(clientDoorReachability({ url: "https://mcp.example.com/mcp", probe: { ok: false, error: "ECONNREFUSED" } }).message,
    /^https:\/\/mcp\.example\.com\/mcp is configured and DOES NOT ANSWER\./);
});

test("billing that cannot be resolved is a failed check in the product's words, and a resolved mode is still said", () => {
  // Harmless stand-ins for what a resolver can throw: the machine's own words, and the resolver's own refusal.
  const raw = () => { throw new Error("EACCES: a harmless stand-in for the machine's words"); };
  const refusal = () => { throw Object.assign(new Error("CLEAROTRON_AI_BILLING=sk-not-a-mode is not a billing mode — refusing to guess"), { billingRefusal: true }); };
  const unresolved = billingLine("anthropic-agent", {}, { resolve: raw });
  assert.deepEqual(unresolved, { kind: "problem", text: billingUnresolved() });
  assert.equal(billingUnresolved(""), "Clearotron couldn\u2019t determine how this engine is paid for. Run clearotron install to check its billing settings.");
  assert.equal(billingUnresolved("npx "), "Clearotron couldn\u2019t determine how this engine is paid for. Run npx clearotron install to check its billing settings.",
    "the install is not named as the reader invokes it");
  const refused = billingLine("anthropic-agent", {}, { resolve: refusal });
  assert.equal(refused.kind, "problem");
  assert.ok(refused.text.startsWith("CLEAROTRON_AI_BILLING is set to a word that is not a billing mode"), refused.text);
  assert.ok(!refused.text.includes("sk-not-a-mode"), refused.text);
  // A mode that resolved stays said, with its own words.
  assert.deepEqual(billingLine("anthropic-agent", {}, { resolve: () => ({ mode: "api-key", apiBilled: true }) }),
    { kind: "ok", text: "billing: api-key — charged per token against ANTHROPIC_API_KEY" });
  assert.deepEqual(billingLine("an-engine-nobody-ships", {}, { resolve: () => ({ mode: "api-key", apiBilled: true }) }),
    { kind: "ok", text: "billing: api-key" }, "a resolved mode was lost because its key could not be named");
});

test("an engine door whose address carries a user and password is asked as the portal dials it, and answers", async () => {
  // The portal's client dials the host and port and sends no user or password from the address, so the portal reaches
  // this door. Doctor's probe kept them, `fetch` refused the address before connecting, and a door that was up read as
  // down (2026-11-27). The probe now asks what the portal asks.
  const seen = [];
  const door = createHttpServer((req, res) => { seen.push({ url: req.url, auth: Boolean(req.headers.authorization) }); res.writeHead(405); res.end(); });
  await new Promise((r) => door.listen(0, "127.0.0.1", r));
  const { port } = door.address();
  const { home } = setUpHome();
  try {
    const { out } = await doctorAsync(home, { PORTAL_MCP_URL: `http://door-user:door-pass@127.0.0.1:${port}`, PORTAL_OPS_TOKEN: "an-ops-token-for-this-test" });
    assert.ok(seen.some((r) => r.url === "/mcp" && !r.auth), `the probe never reached the door as the portal dials it: ${JSON.stringify(seen)}\n${out}`);
    assert.ok(out.includes(`✓ the trigger lane answers at http://127.0.0.1:${port} (405)`), `a door that answered was not reported answering:\n${out}`);
    for (const secret of ["door-user", "door-pass", "an-ops-token-for-this-test"])
      assert.ok(!out.includes(secret), `a credential reached doctor's output (${secret}):\n${out}`);
  } finally { await new Promise((r) => door.close(r)); rmSync(home, { recursive: true, force: true }); }
  assert.equal(String(laneProbeUrl("http://u:p@127.0.0.1:9?token=t")), "http://127.0.0.1:9/mcp");
});

test("an address is shown as scheme, host and path, and one that does not parse is not shown", () => {
  assert.equal(shownAddress("http://u:p@127.0.0.1:9/mcp?token=xyz#frag"), "http://127.0.0.1:9/mcp");
  assert.equal(shownAddress("http://127.0.0.1:9"), "http://127.0.0.1:9", "a bare origin gained a path");
  assert.equal(shownAddress("https://mcp.example.com/"), "https://mcp.example.com/");
  assert.equal(shownAddress("not a url"), null);
  assert.equal(shownAddress(""), null);
  // Both door checks, on every branch that names the address: unprobed, refused, answered.
  for (const probe of [null, { ok: false, error: "ECONNREFUSED" }, { ok: false, status: 500 }, { ok: true, status: 405 }]) {
    const lane = triggerLaneVerdict({ url: "http://u:p@127.0.0.1:9?token=xyz", hasToken: true, posture: HOSTED, probe });
    const client = clientDoorReachability({ url: "https://mcp.example.com/mcp?key=xyz", probe });
    assert.ok(client.message.startsWith("https://mcp.example.com/mcp "), `the client door's line does not name its address: ${client.message}`);
    for (const said of [lane.message, client.message]) {
      assert.doesNotMatch(said, /u:p|xyz|ECONNREFUSED/, `a credential or the error reached the line: ${said}`);
    }
  }
  assert.equal(triggerLaneVerdict({ url: "nope nope", hasToken: false }).message, "PORTAL_MCP_URL is not a URL");
  assert.equal(clientDoorReachability({ url: "nope nope" }).message, "the client connector address is not a URL");
});
