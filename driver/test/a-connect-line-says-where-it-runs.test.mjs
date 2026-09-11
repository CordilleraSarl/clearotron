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
  assert.equal(isWsl({ env: {}, procVersion: "Linux version 6.6.87.2-microsoft-standard-WSL2" }), true);
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
