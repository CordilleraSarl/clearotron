// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// WSL appends the Windows PATH to the Linux one. So on a fresh WSL2 Ubuntu, `claude` resolves to the
// WINDOWS build under /mnt/c before any Linux install is reached — and it is executable by every test
// the resolver makes. The proof turn then fails as "not signed in", because the credential it looks
// for is the Windows one, and the reader is sent to fix a sign-in that was never the problem.
//
// Reported from a real WSL2 attempt: node 22 inside Ubuntu, the wizard naming /mnt/c/nvm4w/nodejs/claude,
// both billing lanes failing the same way.
//
// EVERYTHING HERE IS INJECTED — the PATH, whether this is WSL, and the drive predicate. /mnt/c cannot
// be created on a Linux runner without root, so an arm limited to a real PATH could never drive the
// skip at all and the branch would ship asserted by nobody. The pattern that decides it in production
// is held to real paths by its own arm at the bottom, so both halves are covered rather than one.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { resolveEngineBin, isWsl, windowsShimNote, ON_A_WINDOWS_DRIVE } from "../../bin/onboard.mjs";

// A real executable file, because the resolver tests X_OK and isFile() and a fixture that only names
// a path would prove the skip over candidates the resolver would have rejected anyway.
const root = mkdtempSync(join(tmpdir(), "wsl-path-"));
const binIn = (rel) => {
  const dir = join(root, rel);
  mkdirSync(dir, { recursive: true });
  const p = join(dir, "claude");
  writeFileSync(p, "#!/bin/sh\nexit 0\n");
  chmodSync(p, 0o755);
  return dir;
};
const WINDOWS = binIn("mnt/c/nvm4w/nodejs");     // stands in for /mnt/c/…
const LINUX = binIn("home/you/.nvm/versions/node/v22/bin");
// The predicate the production pattern would answer for a real /mnt/c path.
const onWindowsDrive = (p) => p.startsWith(join(root, "mnt", "c"));
const PATH_BOTH = `${WINDOWS}:${LINUX}`;
const resolve = (PATH, opts) => resolveEngineBin("claude", { env: { PATH }, onWindowsDrive, ...opts });

test("under WSL the Linux install wins, even when the Windows one comes first on PATH", () => {
  const r = resolve(PATH_BOTH, { wsl: true });
  assert.equal(r.path, join(LINUX, "claude"), "the Windows binary was taken");
  assert.ok(r.executable);
  assert.deepEqual(r.skipped, [join(WINDOWS, "claude")], "the skip is not recorded, so nothing can say why");
});

test("with only the Windows one there, the engine reports as MISSING rather than as found", () => {
  // The true answer. Returning the Windows binary here is what sent a reader to a sign-in page.
  const r = resolve(WINDOWS, { wsl: true });
  assert.equal(r.path, null);
  assert.equal(r.executable, false);
  assert.deepEqual(r.skipped, [join(WINDOWS, "claude")]);
});

test("a reader is told what was passed over, and where", () => {
  // Silence here would leave "no binary found" on a machine where `which claude` prints one.
  const r = resolve(WINDOWS, { wsl: true });
  const note = windowsShimNote(r.skipped, "claude");
  assert.match(note, /Windows drive/);
  assert.match(note, /nvm4w/, "the path that was ignored is named");
  assert.match(note, /not signed in/, "and the symptom it would have produced");
  assert.match(note, /inside the Linux distribution/, "and what to do instead");
  assert.equal(windowsShimNote([], "claude"), null, "nothing skipped, nothing said");
});

test("OFF WSL nothing changes — an ordinary Linux box resolves exactly as before", () => {
  // The control that stops this from being a change of behaviour everywhere. A /mnt path on a plain
  // Linux box is an ordinary mount and its binary is an ordinary binary.
  const r = resolve(PATH_BOTH, { wsl: false });
  assert.equal(r.path, join(WINDOWS, "claude"), "first on PATH still wins off WSL");
  assert.deepEqual(r.skipped, []);
});

test("a path the reader typed is reported, never overruled", () => {
  // The same rule the launcher applies to a port somebody stated: a stated address is not moved. It is
  // flagged, so the caller can say what it is, and it is still the path that was asked for.
  const typed = join(WINDOWS, "claude");
  const r = resolveEngineBin(typed, { env: { PATH: "" }, wsl: true, onWindowsDrive });
  assert.equal(r.path, typed, "a typed path was silently replaced");
  assert.equal(r.windowsShim, true, "and nothing marks it as the Windows build");
});

test("WSL is detected from either signal, and a read that fails answers NOT WSL", () => {
  assert.equal(isWsl({ env: { WSL_DISTRO_NAME: "Ubuntu" }, procVersion: "Linux" }), true);
  assert.equal(isWsl({ env: { WSL_INTEROP: "/run/WSL/8_interop" }, procVersion: "Linux" }), true);
  assert.equal(isWsl({ env: {}, procVersion: "Linux 5.15.0 microsoft-standard-WSL2" }), true);
  assert.equal(isWsl({ env: {}, procVersion: "Linux 6.17.0-1022-azure #1 SMP Debian" }), false);
  // The direction that changes nothing. Claiming WSL on a read nobody could make would start refusing
  // candidates under /mnt on an ordinary Linux box with an ordinary mount.
  assert.equal(isWsl({ env: {}, procVersion: "" }), false);
});

test("the production pattern matches a Windows drive and not an ordinary /mnt directory", () => {
  // The half the injected predicate above cannot cover. A drive is ONE letter; /mnt/datadisk1 is a
  // disk on this very machine and must not be swept.
  for (const p of ["/mnt/c/nvm4w/nodejs/claude", "/mnt/d/tools/claude", "/mnt/C/x/claude"])
    assert.ok(ON_A_WINDOWS_DRIVE.test(p), `${p} is a Windows drive`);
  for (const p of ["/mnt/datadisk1/x/claude", "/mnt/data/claude", "/home/you/claude", "/usr/bin/claude", "/mnt/claude"])
    assert.ok(!ON_A_WINDOWS_DRIVE.test(p), `${p} is not a Windows drive`);
});

test("the wizard states the platform refusal BEFORE it resolves a candidate, and offers the way out", () => {
  // A SOURCE READ, AND IT IS THE SECOND-BEST ANSWER. The wizard is a loop inside `runCli`, not a
  // function anything can call with a platform, and the existing wizard checks drive it as a real
  // child process — so a Linux runner cannot make it take the win32 branch without threading a
  // platform through a CLI entry point, which is a larger change than this defect warrants.
  //
  // WHAT THIS CANNOT CATCH, stated rather than left for someone to discover: it proves the call is
  // written and where it sits, not that the branch behaves. `platformEngineRefusal` is driven
  // directly elsewhere, and the ORDER is what is checked here, because the order is the whole defect
  // — the wizard's own no-engine escapes sit behind "no usable binary", and on Windows that test is
  // false, so a refusal placed after resolution would be reached only after the proof turn is spent.
  const src = readFileSync(new URL("../../bin/onboard.mjs", import.meta.url), "utf8");
  const step = src.slice(src.indexOf("engine: for (;;)"));
  const refusal = step.indexOf("platformEngineRefusal()");
  const resolveCall = step.indexOf("resolveEngineBin(process.env[eng.env]");
  assert.ok(refusal > 0, "the wizard does not state the platform refusal at all");
  assert.ok(resolveCall > 0, "the engine step no longer resolves a candidate the way this reads it");
  assert.ok(refusal < resolveCall,
    "the refusal is stated AFTER a candidate is resolved, so a Windows reader still meets found-then-failed");
  assert.match(step.slice(refusal, refusal + 400), /Finish setup with no engine configured\?/,
    "finishing with no engine is not OFFERED, so the way out is a menu row the reader has to notice");
});
