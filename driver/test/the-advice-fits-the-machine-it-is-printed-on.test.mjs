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
import { readFileSync } from "node:fs";

import { whatHoldsPort, stopThatProcess, removeDirectory, chdirPrefix, envPrefix, backgroundManager } from "../../shared/os-advice.mjs";
import { listenErrorMessage, nextFreePort } from "../../shared/listen.mjs";
import { platformEngineRefusal, leaveDemoAdvice } from "../../bin/onboard.mjs";

const POSIX = ["linux", "darwin"];

test("the POSIX advice is byte-for-byte what it always was", () => {
  // The regression that matters most here is not a wrong Windows string; it is a changed Linux one.
  for (const platform of POSIX) {
    assert.equal(whatHoldsPort(18802, { platform }), "ss -ltnp 'sport = :18802'   (or: lsof -i :18802)");
    assert.equal(stopThatProcess({ platform }), "kill <the pid above>");
    assert.equal(removeDirectory("/home/you/demo", { platform }), "rm -rf /home/you/demo");
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

test("doctor states the platform refusal instead of resolving a path it cannot start", () => {
  // `resolveEngineBin` tests with accessSync(X_OK), and Windows has no execute bit — so the
  // extensionless shell script an npm global install writes for Git Bash passes a POSIX executability
  // test while CreateProcess cannot start it. That is how doctor said FOUND and the probe said ENOENT.
  const said = platformEngineRefusal({ platform: "win32" });
  assert.ok(said, "native Windows must be answered before any path is resolved or reported");
  assert.match(said, /does not run on native Windows/);
  assert.match(said, /WSL2/, "a refusal with no way out is half an answer");
  assert.match(said, /demo works here/, "the demo IS supported on this platform and must not read as broken");
  // AND IT MUST NOT QUOTE A PATH. Naming one is what sent the reader looking for a PATH problem they
  // did not have.
  assert.doesNotMatch(said, /[A-Za-z]:\\|\/usr\/|PATH=/, "the refusal quotes a path again");
});

test("and on every other platform it stands aside, so the ordinary checks still run", () => {
  // Without this the arm above is satisfied by a function that refuses everywhere, which would report
  // a working Linux install as unable to run.
  for (const platform of POSIX) {
    assert.equal(platformEngineRefusal({ platform }), null, `${platform} was refused as if it were Windows`);
  }
});

test("the way out of demo mode is the one that can work on that platform", () => {
  const spec = { vendor: "Anthropic", fallback: "claude", install: "npm i -g claude", signIn: "sign in" };

  const win = leaveDemoAdvice(spec, { platform: "win32" });
  assert.equal(win.length, 1);
  assert.match(win[0], /WSL2/);
  // THE LOOP THIS CLOSES. Telling a Windows reader to install the CLI is advice they may have already
  // followed, and following it again cannot change the answer — the refusal is about the platform.
  assert.doesNotMatch(win[0], /install .*CLI \(/, "Windows is told to install a CLI again");
  assert.doesNotMatch(win[0], /Restart any running engine service/, "and to restart a service that cannot help");

  for (const platform of POSIX) {
    const posix = leaveDemoAdvice(spec, { platform });
    assert.equal(posix.length, 2, "the POSIX route keeps both of its lines");
    assert.match(posix[0], /install Anthropic's CLI/);
    assert.match(posix[1], /Restart any running engine service/);
  }
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
// Owner ruling, 2026-09-09. A collision on a DEFAULT port is this process discovering it guessed
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
