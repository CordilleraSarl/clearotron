// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// services-remedy.mjs — the background services a refusal's remedy names, read from this machine.
//
// An install that cannot search refuses an order, and the person who runs it is told what is missing and what
// to do (driver/run-requirements.mjs, `cannotSearchYet`). What to do depends on how this machine runs the
// product. With background services, the settings go in the file those services read, and `clearotron start
// --background` adds a line that file lacks but never replaces one (shared/env-file-merge.mjs). So a reader
// told to run setup and a background start is told the whole remedy only where every missing setting has no
// line there yet, and where that start would refresh these units rather than refuse.
//
// READS ONLY, and only files: no `systemctl`, no process. Filesystem presence is how `bin/start.mjs` decides
// a box is a server, and the answer must not depend on whether a service happens to be running.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { SERVER_INSTALL_SET, SERVER_UNITS, aBackgroundStartRefreshes } from "./server-units.mjs";
import { mergeEnvFile } from "./env-file-merge.mjs";
import { unitEnvPath, activeEnvPath } from "./env-local.mjs";

const readText = (path) => readFileSync(path, "utf8");

/** A unit's declared systemd Type, lowercased; `simple` when the file says none or cannot be read. */
function unitType(path, read) {
  try { return (read(path).match(/^Type=(\w+)/m)?.[1] ?? "simple").toLowerCase(); } catch { return "simple"; }
}

/**
 * The background services installed here, as the refusal's remedy names them, or null when none is.
 *
 * `missing` is the order-time rows the install lacks (run-requirements.mjs, `missingRequirements(...).atOrder`).
 * The result carries:
 *   - `file`, the file the services read: `unitEnvPath()`, the file every shipped unit names.
 *   - `installFile`, the file a background start adds from: the install's settings file, by the resolver the
 *     loader reads with.
 *   - `units`, the installed units that run continuously, for the restart command.
 *   - `addsAll`, true when setup and a background start are the whole remedy. That needs two things. No
 *     missing setting may have a line in `file`, by the merge's own rule: a `NAME=` line counts as present
 *     even when empty, and the merge keeps it. And that start must refresh these units rather than refuse
 *     (aBackgroundStartRefreshes). A file that exists and cannot be read gives `false`, because what it holds
 *     is unknown.
 *
 * `exists` and `read` are parameters so a test can drive the answer over a planted machine.
 */
export function backgroundServices(missing = [], { home = homedir(), repoRoot = undefined, exists = existsSync, read = readText } = {}) {
  const unitDir = join(home, ".config", "systemd", "user");
  const units = [...new Set([...SERVER_INSTALL_SET, ...SERVER_UNITS])].filter((u) => exists(join(unitDir, u)));
  if (!units.length) return null;
  const file = unitEnvPath({ home });
  let text = "";
  let known = true;
  try { text = read(file); } catch (e) { if (e?.code !== "ENOENT") known = false; }
  const names = missing.flatMap((r) => r.anyOf ?? [r.name]);
  const noLineYet = known && names.every((n) => mergeEnvFile(text, { [n]: "x" }).added.includes(n));
  return {
    file,
    installFile: activeEnvPath({ ...(repoRoot ? { repoRoot } : {}), home }),
    units: units.filter((u) => unitType(join(unitDir, u), read) !== "oneshot"),
    addsAll: noLineYet && aBackgroundStartRefreshes(SERVER_UNITS.filter((u) => units.includes(u))),
  };
}
