// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// THE PORTAL DOES NOT WITHHOLD A PASSPHRASE THAT START PRINTS.
//
// On a first start in a terminal, the portal logged "The passphrase is NOT printed here: stderr is not a
// terminal" a few lines above the box in which `clearotron start` printed it (measured on a published beta,
// in a terminal, through the demo). Both were right about their own stream: the supervisor reads the
// portal's standard error through a pipe, so the portal never sees a terminal, while the supervisor's own
// output is one. The supervisor minted the passphrase and handed it down, so it is the supervisor's to show
// or withhold, and the portal now says where it went.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { firstRunCredentialLines, localCredentialHandoff } from "../portal-local-auth.mjs";
import { withFreePorts, saidPortWasTaken } from "./helpers/free-port.mjs";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const RESET = "clearotron passphrase --reset";
const SECRET = "a-passphrase-nobody-should-see";
const lines = (o) => firstRunCredentialLines({ credentialPath: "/h/cred.json", email: "op@localhost", resetCommand: RESET, ...o }).join("\n");

test("handed down, the portal says where the passphrase went and never that it was withheld", () => {
  const piped = localCredentialHandoff({ isTTY: false, resetCommand: RESET });
  const said = lines({ handoff: piped, handedDown: true, passphrase: SECRET });
  assert.doesNotMatch(said, /NOT printed here/, "the portal said it withheld a passphrase the supervisor prints");
  assert.match(said, /Its passphrase is in the box printed below; where it cannot be shown, the box says how to get one\./);
  assert.ok(!said.includes(SECRET), "the portal printed the passphrase it was handed");
});

test("minted by the portal itself, it hands the passphrase over exactly as before", () => {
  // A background start or a restart hands nothing down, and the portal decides by its own stream.
  const onTerminal = lines({ handoff: localCredentialHandoff({ isTTY: true, resetCommand: RESET }), passphrase: SECRET });
  assert.match(onTerminal, new RegExp(`PASSPHRASE: ${SECRET}`));
  const offTerminal = lines({ handoff: localCredentialHandoff({ isTTY: false, resetCommand: RESET }), passphrase: null });
  assert.match(offTerminal, /The passphrase is NOT printed here: stderr is not a terminal/);
  assert.match(offTerminal, /clearotron passphrase --reset/);
});

test("a real first start: the portal's line and the supervisor's box agree", { timeout: 180000 }, async () => {
  const home = mkdtempSync(join(tmpdir(), "handed-down-"));
  const ENDED = /Ordering a clearance from the portal/;
  const stop = async ({ child, closed }) => {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGINT");
    await Promise.race([closed, new Promise((r) => setTimeout(r, 20000))]);
    if (child.exitCode === null && child.signalCode === null) { child.kill("SIGKILL"); await closed; }
  };
  const firstStart = async (ports) => {
    const child = spawn(process.execPath, [join(REPO, "bin", "start.mjs"), "--no-worker"], {
      env: { PATH: process.env.PATH, HOME: home, USERPROFILE: home, CLEAROTRON_NO_ENV_FILE: "1", PORTAL_LOCAL_USER: "op@localhost",
        PORTAL_SERVICE_PORT: String(ports.portal), TRADEMARK_MCP_HTTP_PORT: String(ports.mcp),
        CLIENT_MCP_HTTP_PORT: String(ports.client) },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let said = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (c) => { said += c; });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (c) => { said += c; });
    const closed = new Promise((resolve) => child.on("close", resolve));
    const deadline = Date.now() + 90000;
    while (!ENDED.test(said) && child.exitCode === null && Date.now() < deadline) await new Promise((r) => setTimeout(r, 250));
    return { child, closed, said: () => said };
  };
  const run = await withFreePorts(["portal", "mcp", "client"], firstStart, {
    busy: (r) => !ENDED.test(r.said()) && saidPortWasTaken(r),
    discard: async (r) => { await stop(r); rmSync(home, { recursive: true, force: true }); mkdirSync(home); },
  });
  try {
    const said = run.said();
    assert.match(said, ENDED, "start never reached its summary, so nothing below would be measured");
    assert.match(said, /local sign-in: no credential at .*, so one has been created for op@localhost\./,
      "anti-vacuity: this was not a first start, so the portal had nothing to hand over");
    assert.doesNotMatch(said, /NOT printed here: stderr is not a terminal/,
      "the portal said it withheld the passphrase the supervisor's box hands over");
    assert.match(said, /Its passphrase is in the box printed below/);
    // The supervisor's box still decides by its own stream, which here is a pipe.
    assert.match(said, /│  The passphrase is NOT printed here: stdout is not a terminal/);
  } finally {
    await stop(run);
    rmSync(home, { recursive: true, force: true });
  }
});
