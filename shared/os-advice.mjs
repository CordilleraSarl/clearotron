// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// THE COMMANDS WE TELL A READER TO TYPE, IN THE SHELL THEY ARE ACTUALLY IN.
//
// Three surfaces print a command for the reader to run: the port-in-use refusal, the client door's
// version of the same, and the demo's "remove it later" line. All three printed POSIX commands
// unconditionally — `ss`, `lsof`, `rm -rf` — and the demo is supported on native Windows, where none
// of them exist. A reader who follows the instruction gets "not recognized as a cmdlet", which reads
// as a broken product rather than as advice written for somebody else's machine.
//
// Reported from the owner's own Windows run, 2026-09-09.
//
// ONE PLACE, BECAUSE THREE COPIES OF A RULE DRIFT. The alternative was a ternary at each call site,
// which is how the first one ends up saying `Remove-Item` while the second still says `rm -rf`.
//
// `platform` IS INJECTABLE ON EVERY FUNCTION, and that is the whole testability story: the population
// this protects is the one that cannot run this suite to find out. An arm on a Linux runner has to be
// able to ask what a Windows reader would be shown, or the Windows text is asserted by nobody.
//
// WHAT THIS DOES NOT DO: it does not detect a shell. A reader in Git Bash on Windows has POSIX
// commands and will be shown PowerShell ones. That is the right way round — `process.platform` is a
// fact and the shell is a guess, and being shown a command for the OS you are on is recoverable in a
// way that being shown one for an OS you are not on is not.

/** Is this the platform whose shell has none of the POSIX tools these messages used to name? */
const isWindows = (platform) => platform === "win32";

/**
 * How to see which process holds a TCP port.
 *
 * The POSIX form keeps both spellings it always had: `ss` is on every modern Linux and `lsof` is the
 * one a macOS reader has. The Windows form names the cmdlet AND how to turn its answer into a process,
 * because `Get-NetTCPConnection` reports an owning PID and stops there — a reader given only that has
 * been handed a number and no way to act on it.
 */
export function whatHoldsPort(port, { platform = process.platform } = {}) {
  return isWindows(platform)
    ? `Get-NetTCPConnection -LocalPort ${port} | Select-Object -ExpandProperty OwningProcess | `
      + "ForEach-Object { Get-Process -Id $_ }"
    : `ss -ltnp 'sport = :${port}'   (or: lsof -i :${port})`;
}

/** How to stop the process that turned up, once the reader has found it. */
export const stopThatProcess = ({ platform = process.platform } = {}) =>
  (isWindows(platform) ? "Stop-Process -Id <the PID above>" : "kill <the pid above>");

/**
 * How to remove one directory and everything under it.
 *
 * `-Recurse -Force` is the pair, and both are needed: without `-Recurse` PowerShell prompts for a
 * non-empty directory, and a reader who is told to remove a directory and then asked to confirm each
 * child has been given a command that does not do what the sentence said it would.
 */
export const removeDirectory = (dir, { platform = process.platform } = {}) =>
  (isWindows(platform) ? `Remove-Item -Recurse -Force "${dir}"` : `rm -rf ${dir}`);
