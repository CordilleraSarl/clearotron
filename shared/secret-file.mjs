// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// secret-file.mjs — the house atomic write for a file that holds credentials.
//
// THREE COPIES OF THIS EXISTED AND ONE OF THEM SHIPPED A BLOCKER. The wizard, the launcher and the
// launcher again each composed the same tmp-write, chmod, rename dance beside their own path. When
// `.env` moved to `~/.config/clearotron/.env` (tracker issue 159) the directory had to be created before
// the write, the wizard's copy learned it, and the launcher's did not — so a fresh install could not
// start at all:
//
//   start: could not write /home/<user>/.config/clearotron/.env
//          (ENOENT: no such file or directory, open '.../.env.tmp-3485750')     exit 1
//
// and the error names the temporary file, so it reads as a permissions problem writing `.env` rather
// than a missing folder. A headless operator had no way round it: `doctor` sends them to the wizard, and
// the wizard refuses on a non-TTY.
//
// One writer now. A path whose parent does not exist is the ordinary case on a machine that has never
// run this product, not an error to report.
import { chmodSync, existsSync, mkdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/** Mode for a file holding credentials, and for the directory that holds it. */
export const SECRET_MODE = 0o600;
export const SECRET_DIR_MODE = 0o700;

/**
 * Write `text` to `path` atomically, creating the directory if it is not there.
 *
 * Atomic because a half-written `.env` is a file the loader reads and the engine believes: written
 * beside the target on the same filesystem, its mode fixed BEFORE it is visible under its real name,
 * then renamed over. The temporary file is removed on failure — a stray `.env.tmp-1234` at mode 600 is
 * a second copy of somebody's credentials nobody knows about.
 */
export function writeSecretFile(path, text) {
  mkdirSync(dirname(path), { recursive: true, mode: SECRET_DIR_MODE });
  const tmp = `${path}.tmp-${process.pid}`;
  try {
    writeFileSync(tmp, text, { mode: SECRET_MODE });
    chmodSync(tmp, SECRET_MODE);
    renameSync(tmp, path);
  } catch (e) {
    try { if (existsSync(tmp)) unlinkSync(tmp); } catch { /* nothing to clean */ }
    throw e;
  }
  return path;
}
