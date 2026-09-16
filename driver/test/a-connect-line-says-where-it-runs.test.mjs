// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A CONNECT LINE SAYS WHERE IT RUNS, AND RUNS WHERE IT IS PASTED.
//
// Walked on WSL, 2026-09-11. The "on this computer" lines name Linux paths, so they run in the WSL terminal,
// and nothing said so. The Claude Code line, pasted into PowerShell, failed with "missing required
// argument", because Windows PowerShell 5.1 drops a bare `--`. Run from a directory, it registered the server
// for that directory only. And a demo's line named no workspace, so the connector read the real install's.
import { test } from "node:test";
import assert from "node:assert/strict";
import { connectOffers, WSL_STEP } from "../../shared/connect-clients.mjs";
import { stdioConnectFor, stdioConnectCommand, STDIO_SHAPES } from "../../shared/stdio-connect.mjs";
import { isWsl } from "../../shared/wsl.mjs";

const routes = (o = {}) => Object.fromEntries(Object.keys(STDIO_SHAPES).map((s) => [s, stdioConnectFor(s, { workDir: "/w", ...o })]));

test("on WSL every on-this-computer route opens by saying to run it inside WSL, and no web route does", () => {
  const on = connectOffers({ stdioRoutes: routes(), publicAddress: "https://mcp.example.test", wsl: true }).filter(Boolean);
  const disk = on.filter((o) => o.served && o.route === "disk");
  assert.ok(disk.length >= 3, `too few on-this-computer routes for this to mean anything: ${disk.length}`);
  for (const o of disk) assert.equal(o.steps[0]?.text, WSL_STEP, `${o.client.id} does not open with where to run it`);
  for (const o of on.filter((x) => x.route === "public-http"))
    assert.ok(!o.steps.some((s) => s.text === WSL_STEP), `${o.client.id}'s web route was told to run inside WSL`);
  // THE CONTROL: off WSL, nobody is told about WSL.
  const off = connectOffers({ stdioRoutes: routes(), publicAddress: "https://mcp.example.test", wsl: false }).filter(Boolean);
  assert.ok(!off.some((o) => o.steps.some((s) => s.text === WSL_STEP)), "an install that is not on WSL was told to run inside it");
});

test("WSL is read from WSL_DISTRO_NAME, WSL_INTEROP or the kernel's own name, and a failed read is not WSL", () => {
  assert.equal(isWsl({ env: { WSL_DISTRO_NAME: "Ubuntu" }, procVersion: "" }), true);
  assert.equal(isWsl({ env: { WSL_INTEROP: "/run/WSL/1_interop" }, procVersion: "" }), true);
  assert.equal(isWsl({ env: {}, procVersion: "Linux version 6.6.87.2-standard-WSL2" }), true);
  assert.equal(isWsl({ env: {}, procVersion: "Linux version 6.17.0-1022-azure" }), false);
  assert.equal(isWsl({ env: {}, procVersion: "" }), false);
});

test("the Claude Code line registers for the user, and quotes its separator on Windows", () => {
  const posix = stdioConnectCommand({ workDir: "/w", platform: "linux" });
  assert.match(posix, /^claude mcp add trademark-artifacts --scope user /, "the server would be registered for one directory only");
  assert.match(posix, / -- node \S+server\.mjs$/);
  const win = stdioConnectCommand({ workDir: "C:\\w", platform: "win32" });
  assert.match(win, / "--" node /, "Windows PowerShell 5.1 drops a bare --, and the line fails there");
});

test("every shape carries the reports folder when it is known, and invents none when it is not", () => {
  for (const shape of Object.keys(STDIO_SHAPES)) {
    assert.match(stdioConnectFor(shape, { workDir: "/w", reportsDir: "/p" }).text, /CLEAROTRON_REPORTS_DIR\W+\/p/, `${shape} dropped the reports folder`);
    assert.doesNotMatch(stdioConnectFor(shape, { workDir: "/w" }).text, /CLEAROTRON_REPORTS_DIR/, `${shape} invented a reports folder`);
  }
});

// ── ON WSL THE ROW CROSSES THE BOUNDARY ITSELF ───────────────────────────────────────────────────
//
// The rows named a Linux path and left the reader to run them in the WSL terminal. For somebody whose
// product runs in WSL the assistant on WINDOWS is the normal one, and it read
// `/home/<user>/…/server.mjs` as `C:\home\<user>\…`: MODULE_NOT_FOUND, four times, then "couldn't
// start". The path was right and the interpreter was on the wrong side.
//
// Driven on the composed strings, which is what this box can see. Criterion 4 — the row pasted into
// Claude Desktop and Claude Code on a real Windows machine — is the owner's, and is not claimed here.
test("every on-this-computer shape starts the server INSIDE the distribution when the install is on WSL", async () => {
  const { STDIO_SHAPES, stdioConnectFor } = await import("../../shared/stdio-connect.mjs");
  const wsl = { distro: "Ubuntu" };
  const opts = { installRoot: "/opt/clearotron", workDir: "/srv/clearotron/work", wsl };

  for (const shape of Object.keys(STDIO_SHAPES)) {
    const text = stdioConnectFor(shape, opts).text;
    assert.match(text, /wsl\.exe/, `${shape} still hands a Windows host a Linux interpreter`);
    assert.match(text, /-d[\s",]+Ubuntu/, `${shape} does not name the distribution, so it starts whichever is default`);
    assert.ok(text.includes("/opt/clearotron/mcp-server/server.mjs"), `${shape} lost the server path`);
    // THE ENVIRONMENT HAS TO CROSS. A host on Windows sets variables for the process it starts, which
    // is wsl.exe; they stop at the boundary. Inside the command, `env` sets them where the server reads.
    assert.match(text, /env[\s",]+CLEAROTRON_WORK_DIR=\/srv\/clearotron\/work/, `${shape} sets the work directory where the server will never see it`);
  }
});

test("off WSL every shape is byte-identical to what it always was", () => {
  // THE CONTROL, and the half that says this is a new branch rather than a rewrite: every reader on
  // macOS, Linux and Windows-without-WSL must get exactly the command they got before.
  for (const shape of Object.keys(STDIO_SHAPES)) {
    const text = stdioConnectFor(shape, { installRoot: "/opt/app", workDir: "/w" }).text;
    assert.doesNotMatch(text, /wsl\.exe/, `${shape} wrapped a reader who is not on WSL`);
    assert.match(text, /node/, `${shape} stopped naming the interpreter`);
  }
});

test("the distribution is named when we know it, and left to the default when we do not", async () => {
  const { wslTarget } = await import("../../shared/wsl.mjs");
  const { stdioConnectFor } = await import("../../shared/stdio-connect.mjs");
  // A machine with more than one distribution has a default that may hold no install, so the name
  // travels wherever the environment carries it.
  assert.deepEqual(wslTarget({ env: { WSL_DISTRO_NAME: "Ubuntu" } }), { distro: "Ubuntu" });
  assert.deepEqual(wslTarget({ env: { WSL_INTEROP: "/run/WSL/8_interop" } }), { distro: null },
    "WSL with no name is still WSL — the wrapper is right, the -d is what cannot be guessed");
  assert.equal(wslTarget({ env: {}, procVersion: "Linux 6.17.0-1022-azure", interopEntry: false }), null,
    "a plain Linux box must not be handed a Windows wrapper");

  const unnamed = stdioConnectFor("claude-cli", { installRoot: "/opt/clearotron", wsl: { distro: null } }).text;
  assert.match(unnamed, /wsl\.exe -e node/, "with no distribution name the command runs in the default one");
  assert.doesNotMatch(unnamed, /-d\b/, "it invented a distribution name");
});

test("the WSL step says WHICH SIDE its command is for, and invites no paste inside the distribution", () => {
  // The sentence this replaces read "paste it where your assistant lives, on Windows or in the WSL
  // terminal, whichever it is" — and the command cannot keep that promise. Under WSL there is exactly
  // one launcher per host shape, the Windows-side `wsl.exe` one; an assistant inside the distribution
  // cannot use it. Somebody took the invitation from Claude Code inside WSL and got CONNECTION_CLOSED
  // (measured 2026-09-16 on 0.3.2-beta.1).
  //
  // PINNED TO THE PROPERTY, NOT THE SPELLING: the step must name the side it is for. A rewrite that
  // says it some other way passes; one that stops saying it at all does not.
  assert.match(WSL_STEP, /\bWindows\b/, "the step no longer says which side the command is for");

  // …and it must not tell the reader the one command works on both sides. This is the specific claim
  // that sent a reader into CONNECTION_CLOSED, so it is worth refusing by name rather than trusting
  // the positive arm above to catch a reworded version of it.
  assert.doesNotMatch(WSL_STEP, /whichever it is/i, "the step invites a paste on either side again");
  assert.ok(!/on Windows or in the WSL terminal/i.test(WSL_STEP),
    "the step offers both sides for a command that works on one");
});
