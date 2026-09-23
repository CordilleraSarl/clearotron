// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// WHAT A READER IS TOLD TO TYPE, AND WHAT THEY ARE TOLD ABOUT THEIR OWN MACHINE.
//
// Reported from a real Windows run, 2026-09-09. Three surfaces printed POSIX commands unconditionally
// — `ss`, `lsof`, `rm -rf` — on a platform where the demo is supported and none of them exist. And
// doctor reported the engine FOUND at a path the platform cannot start, then failed to start it.
//
// PLATFORM IS INJECTED, NEVER READ, and that is the whole reason these arms exist rather than a note.
// The population this protects cannot run this suite: a Windows reader is exactly the person who will
// never see a green tick here. An arm on a Linux runner that could not ask what Windows is shown would
// leave every Windows sentence asserted by nobody — so each function takes the platform, the same
// shape `preflightEngineBinary` already uses for its own refusal.
//
// BOTH DIRECTIONS, ALWAYS. The Windows text being right is half of it; the POSIX text being UNCHANGED
// is the other half, because this shipped to people who are using it today.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

import { whatHoldsPort, stopThatProcess, removeDirectory, chdirPrefix, envPrefix, backgroundManager } from "../../shared/os-advice.mjs";
import { listenErrorMessage, nextFreePort } from "../../shared/listen.mjs";
import { leaveDemoAdvice, programDisagreement } from "../../bin/onboard.mjs";
import { ENGINE_BINARIES } from "../driver.config.mjs";
import { reachableCommand } from "../../shared/invocation.mjs";
import { buildFlagSnapshot, snapshotPath } from "../flag-snapshot.mjs";
import { handRunEnv } from "./drive-env.mjs";

const { BACKGROUND_UNITS } = await import("../../bin/start.mjs");
const POSIX = ["linux", "darwin"];
const HERE = dirname(fileURLToPath(import.meta.url));
const SYSTEMD = join(HERE, "..", "systemd");
const ONBOARD = join(HERE, "..", "..", "bin", "onboard.mjs");
const MOCK = join(HERE, "mock-claude.mjs");
// A PATH holding node and nothing else of this machine's, so doctor's environment is composed from nothing.
const NODE_BIN = mkdtempSync(join(tmpdir(), "advice-node-"));
symlinkSync(process.execPath, join(NODE_BIN, "node"));

test("the POSIX advice is byte-for-byte what it always was", () => {
  // The regression that matters most here is not a wrong Windows string; it is a changed Linux one.
  for (const platform of POSIX) {
    assert.equal(whatHoldsPort(18802, { platform }), "ss -ltnp 'sport = :18802'   (or: lsof -i :18802)");
    assert.equal(stopThatProcess({ platform }), "kill <the pid above>");
    assert.equal(removeDirectory("/srv/demo", { platform }), "rm -rf /srv/demo");
  }
});

test("on Windows the advice names commands that exist there, and none that do not", () => {
  const port = whatHoldsPort(18802, { platform: "win32" });
  assert.match(port, /Get-NetTCPConnection -LocalPort 18802/);
  // NAMING THE CMDLET IS NOT ENOUGH. It reports an owning PID and stops; a reader handed a number and
  // no way to act on it has been given half an instruction.
  assert.match(port, /Get-Process/, "the reader is left with a PID and no way to turn it into a process");
  assert.match(stopThatProcess({ platform: "win32" }), /Stop-Process/);

  const rm = removeDirectory("C:\\Users\\you\\demo", { platform: "win32" });
  assert.match(rm, /Remove-Item/);
  // `-Recurse` AND `-Force`: without the first, PowerShell prompts per child for a non-empty directory,
  // and a command that asks eighty questions is not the one-line removal the sentence promised.
  assert.match(rm, /-Recurse/);
  assert.match(rm, /-Force/);

  for (const s of [port, stopThatProcess({ platform: "win32" }), rm]) {
    assert.doesNotMatch(s, /\bss\b|\blsof\b|\brm -rf\b|\bkill\b/,
      `a POSIX command survived into the Windows advice: ${s}`);
  }
});

test("the way out of demo mode is the one that can work on that platform", () => {
  const spec = { vendor: "Anthropic", fallback: "claude", install: "npm i -g claude", signIn: "sign in" };

  // WINDOWS TAKES THE SAME FIRST LINE: setup is the way out there too. Its second line names the one
  // restart Windows has, the window, because it has no background services and no `~/.env` they read.
  const win = leaveDemoAdvice(spec, { platform: "win32", command: "clearotron install" });
  assert.equal(win.length, 2);
  assert.match(win[0], /^To leave demo: run `clearotron install`\. It offers to install Anthropic's CLI/);
  assert.equal(win[1], "If Clearotron is already running, close its window and start it again: it reads the settings setup writes when it starts.");
  assert.doesNotMatch(win.join(" "), /--background|~\/\.env|WSL2/, "Windows was named a route it does not have");

  for (const platform of POSIX) {
    const posix = leaveDemoAdvice(spec, { platform, command: "npx clearotron install" });
    assert.equal(posix.length, 2, "the POSIX route keeps both of its lines");
    assert.match(posix[0], /^To leave demo: run `npx clearotron install`\. It offers to install Anthropic's CLI/);
    assert.match(posix[1], /restart them afterwards/);
  }
});

test("the way out of demo is setup, which installs the program, and names no command the reader's shell lacks", () => {
  // Setup installs the program into a folder that is not on PATH, so the old advice (install it with
  // `npm install -g`, then run `claude` to sign in, then restart so the service re-reads its PATH) sent a
  // reader to a command their shell does not have, and to a restart for a reason that is no longer true.
  for (const [id, eng] of Object.entries(ENGINE_BINARIES)) {
    const [first, second] = leaveDemoAdvice(eng, { platform: "linux", command: "npx clearotron install" });
    assert.match(first, /^To leave demo: run `npx clearotron install`\./, `${id}: the way out is not setup`);
    assert.match(first, new RegExp(`offers to install ${eng.vendor}'s CLI if this machine has none`), id);
    assert.doesNotMatch(first, new RegExp(`\`${eng.fallback}[\\s\`]`), `${id}: a bare \`${eng.fallback}\` is named, which setup's copy does not put on PATH`);
    assert.doesNotMatch(first, /npm install -g/, `${id}: the hand install setup replaced is still offered`);
    // The restart is said for what it is still for: the settings setup writes, read when a service starts.
    assert.doesNotMatch(second, /re-reads its PATH|notice a new install/, `${id}: the restart is still justified by PATH`);
    assert.match(second, /^If Clearotron's services are already running, restart them afterwards: they read the settings setup writes when they start/);
    // Background services read `~/.env`, which setup does not write, so a restart alone does not bring them
    // setup's settings, and the sentence above is not the whole answer for them.
    assert.match(second, /Background services read `~\/\.env` instead, which setup does not write/,
      "the advice to restart the services does not say that background services read another file");
    assert.match(second, /start --background` adds to it only the lines it lacks, so change there any setting it already has/,
      "the advice does not say how to change a setting background services already have");
  }
  // Unset, the command is the one the reader can type from here.
  assert.ok(leaveDemoAdvice(ENGINE_BINARIES["anthropic-agent"], { platform: "linux" })[0].includes(`\`${reachableCommand("install")}\``));
});

test("doctor's engine-program disagreement says which side could not find it, and names setup's install and the restart", () => {
  // It said "Restart the engine service so it re-reads its PATH, or install the CLI where the service can see
  // it" in both directions, from before setup installed the program into a folder the services find without
  // PATH, and one direction is a machine the services found the program on.
  const command = "npx clearotron install";
  const unseen = programDisagreement({ capture: "not found", live: "found" }, { command });
  // It opens with what the services recorded when they last started, the only time the capture is written.
  assert.match(unseen, /^When the services last started they recorded the engine program as not found; this machine reads it as found\. A NEW search will refuse while that is true\./);
  // Without units, setup is the remedy, and it installs only where this shell finds no program: over one it
  // finds, it writes that program's full path instead.
  assert.match(unseen, / Restart them so they look again\. If they still cannot find it, it is not on the PATH they run with: run `npx clearotron install`: it writes the full path of the program this shell finds into Clearotron's settings, or offers to install a copy found without PATH if this shell finds none\. Then restart them\.$/);
  assert.doesNotMatch(unseen, /let it install the program where they look/, "an install promised where setup would not offer one");
  // With units, the services read `~/.env`, which setup does not write, so the remedy is the setting there.
  const units = programDisagreement({ capture: "not found", live: "found" },
    { command, hosted: true, setting: "CLEAROTRON_CLAUDE_PATH", file: "/srv/clearotron/.env" });
  assert.match(units, / If they still cannot find it, it is not on the PATH they run with: set CLEAROTRON_CLAUDE_PATH to its full path in \/srv\/clearotron\/\.env, which they read when they start, then restart them\.$/);
  assert.doesNotMatch(units, /npx clearotron install/, "setup named where what it writes does not reach the services");
  const gone = programDisagreement({ capture: "found", live: "not found" }, { command });
  assert.match(gone, /^When the services last started they recorded the engine program as found; this machine reads it as not found\. A NEW search will refuse while that is true\. If the program was removed, run `npx clearotron install` to install it again \(the copy setup installs is found without PATH\), then restart the services so they look again\.$/);
  assert.doesNotMatch(gone, /could not find|cannot find it/, "the services are said to have missed a program they found");
  for (const s of [unseen, units, gone]) {
    assert.doesNotMatch(s, /re-reads its PATH|where the service can see it|the CLI\b/, s);
    assert.doesNotMatch(s, /last run/, `the capture is written when the services start, not by a run: ${s}`);
  }
  // Unset, the command is the one the reader can type from here.
  assert.ok(programDisagreement({ capture: "not found", live: "found" }).includes(`\`${reachableCommand("install")}\``));
});

test("doctor prints that disagreement over a capture the services wrote, and nothing over one that agrees", () => {
  // Driven, not read: a real `doctor --check` in a throwaway home whose pool holds a capture written when the
  // services last started, and whose settings file names a program this machine can run.
  const drive = (binaryPresent, { hosted = false } = {}) => {
    const home = mkdtempSync(join(tmpdir(), "advice-capture-"));
    const pool = join(home, "pool");
    mkdirSync(join(pool, "_state"), { recursive: true });
    writeFileSync(snapshotPath(pool), JSON.stringify(buildFlagSnapshot({}, { capturedAt: new Date().toISOString(),
      engine: { id: "anthropic-agent", vendor: "Anthropic", known: true, billing: { mode: "subscription" }, binaryPresent } })));
    mkdirSync(join(home, ".config", "clearotron"), { recursive: true });
    writeFileSync(join(home, ".config", "clearotron", ".env"),
      ["CLEAROTRON_AI=anthropic-agent", `CLEAROTRON_CLAUDE_PATH=${MOCK}`, `CLEAROTRON_REPORTS_DIR=${pool}`].join("\n") + "\n");
    if (hosted) {
      // The shipped background units, as written, reading `<home>/.env`, which holds no program setting.
      const unitDir = join(home, ".config", "systemd", "user");
      mkdirSync(unitDir, { recursive: true });
      for (const u of BACKGROUND_UNITS) writeFileSync(join(unitDir, u), readFileSync(join(SYSTEMD, u), "utf8"));
      writeFileSync(join(home, ".env"), ["CLEAROTRON_AI=anthropic-agent", `CLEAROTRON_REPORTS_DIR=${pool}`].join("\n") + "\n");
    }
    try {
      return { home, out: execFileSync(process.execPath, [ONBOARD, "--check"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 60000,
        env: handRunEnv({ HOME: home, USERPROFILE: home, PATH: `${NODE_BIN}:/usr/bin:/bin`, CLEAROTRON_REPORTS_DIR: pool }, {}) }) };
    } catch (e) { return { home, out: `${e.stdout ?? ""}${e.stderr ?? ""}` }; }
  };
  const { out } = drive(false);
  assert.match(out, /When the services last started they recorded the engine program as not found; this machine reads it as found/, out);
  assert.match(out, /Restart them so they look again\. If they still cannot find it, it is not on the PATH they run with: run `[^`]+`: it writes the full path of the program this shell finds into Clearotron's settings, or offers to install a copy found without PATH if this shell finds none\. Then restart them\./, out);
  assert.doesNotMatch(out, /re-reads its PATH|the last run recorded/, out);
  // With units placed, the services read `<home>/.env`, and that file and the program setting are what is named.
  const units = drive(false, { hosted: true });
  assert.match(units.out, new RegExp(`it is not on the PATH they run with: set CLEAROTRON_CLAUDE_PATH to its full path in ${join(units.home, ".env").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}, which they read when they start, then restart them\\.`), units.out);
  // CONTROL: the same machine under a capture that found the program says nothing about it, so the line
  // above came from the capture and not from something else doctor prints.
  assert.doesNotMatch(drive(true).out, /recorded the engine program as/);
});

// ── the invocation string every surface prints, and the two prefixes that compose into it ───────────
//
// These are not demo lines. `invocationPrefix` feeds doctor, the wizard, the start banner and the
// stop/disconnect advice, so one wrong separator is wrong on every surface at once — which is why the
// arms are here at the helper rather than at each caller.

test("the directory prefix uses a separator the reader's shell actually has", () => {
  // `&&` IS THE PART THAT FAILS, not the backslashes. Windows PowerShell 5.1 — the default shell on a
  // stock machine — has no `&&` operator, so `cd X && npx` is a parse error there.
  assert.equal(chdirPrefix("/opt/x", { platform: "linux" }), "cd /opt/x && ");
  const win = chdirPrefix("C:\\Users\\you\\npm-cache", { platform: "win32" });
  assert.doesNotMatch(win, /&&/, "PowerShell 5.1 has no && at all");
  assert.match(win, /;\s*$/, "the pair still has to be sequenced");
  // Plain containment rather than a pattern: a backslash path in a regex literal needs doubling twice
  // over, and the first version of this arm failed on its own escaping while the value was correct —
  // an assertion whose escaping is harder than its subject reports the test as the defect.
  assert.ok(win.includes('cd "C:\\Users\\you\\npm-cache"; '),
    `the directory must be quoted for the spaces a Windows home path carries: ${win}`);
});

test("a one-command environment variable is set the way that shell sets it", () => {
  assert.equal(envPrefix("VAR", "/tmp/x", { platform: "linux" }), "VAR=/tmp/x ");
  const win = envPrefix("VAR", "C:\\tmp\\x", { platform: "win32" });
  // `VAR=value cmd` is POSIX juxtaposition with no PowerShell equivalent: pasted there, the variable
  // NAME is reported as an unrecognised cmdlet, which names the wrong half of the line as the fault.
  assert.equal(win, '$env:VAR="C:\\tmp\\x"; ');
  assert.doesNotMatch(win, /^VAR=/, "the POSIX juxtaposition survived onto a shell that has no such form");
});

test("the background route is offered only where the product has one", () => {
  assert.equal(backgroundManager({ platform: "linux" }), "systemd");
  // `--background` installs and enables service units. There are none on Windows, so offering it named
  // a flag that cannot succeed and a service manager that cannot be installed.
  assert.equal(backgroundManager({ platform: "win32" }), null);
});

test("the port refusal does not tell a reader to stop the thing they are reading it in", () => {
  const said = listenErrorMessage({ code: "EADDRINUSE" },
    { what: "the portal", host: "127.0.0.1", port: 18802, portVar: "PORTAL_PORT", portSource: "default" });
  assert.match(said, /forwarded port counts/,
    "an editor forwarding this port holds it exactly as a second copy does, and that is the case the "
    + "old wording sent a reader to kill");
  assert.match(said, /Move this instance instead/, "moving this instance must come before stopping the holder");
  // BOTH HALVES. Removing the stop advice entirely would leave a reader with a stray second copy and
  // no way to clear it; the fix is the ORDER and the condition, not the absence.
  assert.match(said, /once you know what the holder is and that you do not need it/);
});

// ── a door nobody addressed moves; one somebody stated does not ─────────────────────────────────────
//
// Ruling, 2026-09-09. A collision on a DEFAULT port is this process discovering it guessed
// somebody else's address — nobody stated that number, so stepping off it loses nothing. A collision
// on a port the reader SET is an address conflict they can reason about, and moving it silently takes
// the product away from where they pointed it.
//
// `isFree` is injected here for the same reason the platform is above: a walker driven by occupying
// real ports is tested against whichever ports happened to be free on the machine that ran it. The
// end-to-end drive against a real listener is in the PR body; these hold the rule.

test("the walk steps over what is held and stops at the first free port", async () => {
  const held = new Set([5000, 5001, 5002]);
  assert.equal(await nextFreePort(5000, (p) => !held.has(p)), 5003);
});

test("a port already claimed by another door is not free, though nothing is listening on it yet", async () => {
  // The doors are chosen one after another and bound later. Two landing on one number is the same
  // collision deferred, and the second to bind would be the one that failed.
  const held = new Set([5000]);
  assert.equal(await nextFreePort(5000, (p) => !held.has(p), { claimed: new Set([5001, 5002]) }), 5003);
});

test("nothing free in range answers null, so the caller refuses on the port that was asked for", async () => {
  // NOT A FALLBACK. Sending a reader to a port this could not prove was free either would be a second
  // guess dressed as an answer, and the honest refusal already exists.
  assert.equal(await nextFreePort(5000, () => false, { limit: 4 }), null);
});

test("the walk is bounded, and does not run off the end of the port space", async () => {
  assert.equal(await nextFreePort(65534, () => false), null);
});

test("the move is wired behind all three conditions, and the refusal still stands under it", () => {
  // STRUCTURAL, AND THE ALTERNATIVE REALLY IS UNAVAILABLE HERE rather than merely awkward. The three
  // conditions are inline reads inside `if (isMain)` — an entry-point block, not a function — so there
  // is nothing to hand a recorder to without spawning the CLI and starting the product. The RULE it
  // guards is driven above, on injected inputs; what this holds is that the rule is actually reached
  // and that the previous refusal was not replaced by it.
  //
  // Say what it cannot see: it reads the order and presence of the conditions, not their effect. An
  // end-to-end drive against a real planted listener is in the change's own description.
  const src = readFileSync(new URL("../../bin/start.mjs", import.meta.url), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");

  const guard = src.match(/if \(code === "EADDRINUSE"[^\n]*\)/)?.[0] ?? "";
  assert.ok(guard, "the move is gone, or its guard no longer keys on the address being taken");
  assert.match(guard, /!fronted\.length/, "a fronted deployment would have its doors moved out from under it");
  assert.match(guard, /process\.env\[portVar\]/, "a port the reader stated would be moved");

  // AND THE REFUSAL IS STILL THERE. Replacing it rather than falling through to it would turn every
  // other bind failure — EACCES, a fronted collision, an exhausted range — into silence.
  assert.match(src, /if \(code\) fatal\(listenErrorMessage\(/,
    "the ordinary refusal was replaced rather than left underneath the move");
});
