// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// browser-temp-root.mjs — give a browser launch its own temp root, so an untidy exit leaks nothing shared.
//
// ── WHAT LEAKS, AND WHY IT IS NOT THE PROFILE DIRECTORY ───────────────────────────────────────────
//
// Chrome does not keep its process-singleton lock in `--user-data-dir`. It creates a directory named
// `com.google.Chrome.XXXXXX` in the system temp directory, holding `SingletonCookie` and a
// `SingletonSocket` unix socket, and symlinks the profile's entry at it. The reason is length: a
// profile path may be too long for a unix socket, so the lock is shortened through the temp root.
//
// Every launcher here already removes its own profile directory. None of them could remove that one,
// because none of them knows its name. Measured on a development machine 2026-09-09: 4,855 such
// directories under one shared temp root, the oldest five days old, still accumulating — the residue
// of runs that ended without running their cleanup, mostly cancelled continuous-integration jobs.
//
// The fix is not to find and delete them. It is to stop them being shared: the directory is created in
// `GetTempDir()`, which honours `TMPDIR`, so a run that exports its own temp root gets its own copy of
// the lock inside it and takes it away when the root goes.
//
// ── THE BYTE BUDGET, WHICH IS WHY THIS FILE REFUSES RATHER THAN TRUSTS ────────────────────────────
//
// A unix socket address is a fixed 108-byte field, so the socket path must fit in 107 bytes plus a
// terminator. The lock directory and socket name add a fixed 41 characters to the temp root, leaving
// 66 for the root itself. One character more and Chrome does not degrade — it aborts, with a fatal
// log line about the socket path and a core dump.
//
// That failure is why the check below exists. A crash in a continuous-integration step, reported as a
// core dump, is not something a reader connects to the length of a checkout path; and the length is
// not a constant of this project, because a run can be rooted anywhere a caller or a runner puts it.
// So the budget is asserted at the point the root is chosen, and the refusal states the length it
// measured, the limit, and the path — which is the whole of what a reader needs to fix it.
//
// The boundary is measured, not derived: walking root lengths across it, 66 starts and 67 aborts.
import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { removeOnExit } from "./reap-on-exit.mjs";

/** A unix socket address field is 108 bytes; the last is the terminator. */
export const SUN_PATH_MAX = 107;

/** `/com.google.Chrome.XXXXXX/SingletonSocket` — what the lock adds to the temp root. */
export const LOCK_SUFFIX = "/com.google.Chrome.XXXXXX/SingletonSocket";

/** The longest temp root a browser can be launched under. */
export const MAX_ROOT_LENGTH = SUN_PATH_MAX - LOCK_SUFFIX.length;

/**
 * Why `dir` cannot be a browser temp root, or `null` if it can.
 *
 * Returned rather than thrown so a caller can decide: a check that has already produced a result
 * should say this and exit, not lose the result to an exception.
 */
export function rootRefusal(dir) {
  if (typeof dir !== "string" || dir === "") return "a browser temp root must be a non-empty path";
  if (dir.length <= MAX_ROOT_LENGTH) return null;
  return (
    `browser temp root is ${dir.length} characters and the limit is ${MAX_ROOT_LENGTH}: ${dir}\n` +
    `  A browser writes its process-singleton socket at <root>${LOCK_SUFFIX}, and a unix socket ` +
    `address holds ${SUN_PATH_MAX} characters. Over that the browser aborts with a fatal error about ` +
    `the socket path rather than reporting anything this check could read.\n` +
    `  Run from a shorter path, or set TMPDIR to one.`
  );
}

/** The refusal as an exception, for a caller with nothing to lose by throwing. */
export function assertRootFits(dir) {
  const why = rootRefusal(dir);
  if (why) throw new Error(why);
  return dir;
}

/**
 * A temp root for one browser run, removed when this process exits by any route it can observe.
 *
 * Rooted at the ambient temp directory rather than anywhere relative to the checkout, and that is a
 * decision rather than a convenience: the ambient root is short by construction, while a checkout,
 * a worktree or a per-session scratch directory is routinely past the budget above. Nesting is
 * still correct — under a test runner that has already exported its own root, this lands inside it
 * and is carried away with it.
 */
export function browserTempRoot(prefix = "browser-run-") {
  const root = mkdtempSync(join(tmpdir(), prefix));
  assertRootFits(root);
  removeOnExit(root);
  return root;
}

/**
 * The environment a browser must be spawned with so its singleton lock lands under `root`.
 *
 * `TMPDIR` is the whole mechanism, so this refuses rather than passing a root that cannot work.
 */
export function browserEnv(root, env = process.env) {
  assertRootFits(root);
  return { ...env, TMPDIR: root };
}

/**
 * A temp root and a profile directory inside it, plus the environment to spawn with.
 *
 * The profile goes INSIDE the root so one removal covers both. Several call sites used to make the
 * profile directly in the shared temp directory and remove it on their success path; that left the
 * singleton lock behind on every other path, which is the leak this module exists for.
 */
export function browserRun(prefix = "browser-run-") {
  const root = browserTempRoot(prefix);
  const profile = join(root, "profile");
  mkdirSync(profile, { recursive: true });
  return { root, profile, env: browserEnv(root) };
}
