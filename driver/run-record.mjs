// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// run-record.mjs — the one door to a run's files: where they are, how they are read, how they are written.
//
// It imports node builtins and `shared/driver-dir.mjs` and nothing else, so any module can import it without
// joining an import loop. File names on disk do not change here: the bench and the archive read them.
//
// ── TWO READERS, BECAUSE THE TWO FAILURES MEAN DIFFERENT THINGS ──────────────────────────────────────
//
// A missing or corrupt file has to stay what it was at each call site. `readJson` throws, so a run that needs
// the file stops and says why. `readJsonOr` hands back the fallback the caller names, for a file whose absence
// the caller has already decided how to treat, and `readJsonOrNull` is that reader with null. One reader for
// both would turn some thrown error into a null, and a null reads as "nothing there" where the truth was
// "could not look".

import { readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";

export { DRIVER_DIR, RUN_DIR_MODE, driverDir, driverFileName, driverRel, ensureDriverDir, labelOfDriverFile } from "../shared/driver-dir.mjs";

/** The parsed JSON at `file`. Throws when the file is missing, unreadable or not JSON. */
export function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

/** The parsed JSON at `file`, or `fallback` when the file is missing, unreadable or not JSON. */
export function readJsonOr(file, fallback) {
  try { return readJson(file); }
  catch { return fallback; }
}

/** The parsed JSON at `file`, or null when the file is missing, unreadable or not JSON. */
export function readJsonOrNull(file) {
  return readJsonOr(file, null);
}

// The tmp lives in the TARGET's directory (a sibling name), so the rename never crosses a device; a reader
// sees the old complete file or the new one, never a truncation.
export function atomicWrite(file, text) {
  // unique tmp name: concurrent runs can rollup the same STATUS.md — a shared .tmp would cross-rename/ENOENT
  // between writers (content is derived-from-disk either way, so last-writer-wins on the RENAME is fine; the
  // tmp file itself must not be shared).
  const tmp = `${file}.${process.pid}.${Date.now().toString(36)}.tmp`;
  writeFileSync(tmp, text);
  try { renameSync(tmp, file); }
  catch (e) {
    try { unlinkSync(tmp); } catch { /* cleanup is best-effort — the rename failure is the real error */ }
    throw e;
  }
}
