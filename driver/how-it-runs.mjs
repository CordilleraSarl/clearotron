// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// how-it-runs.mjs — how the process refusing an order runs, as the remedy it names needs it.
//
// An install that cannot search refuses an order, and three places tell the person who runs it what to do: the
// portal, the run's refusal in the operator's log, and `clearotron start`. What to do depends on the
// configuration the refusing process actually uses and on how it is reloaded (the owner's words, composed in
// driver/run-requirements.mjs, `remedyFor`). This reads that, once, for the portal and the runner alike:
//
//   launcher  a user unit among the product's units, which are byte for byte what `clearotron start
//             --background` writes, with no server unit it does not manage beside them. They read
//             `unitEnvPath()`, and that command adds a line the file lacks and never replaces one.
//   units     a user unit among the product's units, otherwise. Their `EnvironmentFile=` lines name one file.
//   service   run by systemd, and not one of the above: a system unit, another unit, or units that name no one
//             file. Nothing here can name its configuration or its restart.
//   start     a child of a foreground `clearotron start`, which hands it the file it read as a flag.
//   hand      started some other way: it reads its own settings file, or none.
//
// READS ONLY: files, the process's own cgroup and its own environment. No `systemctl`, no process. Every input is
// a parameter, so a test drives each state over a machine of its own and never this machine's units.
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { SERVER_INSTALL_SET, SERVER_UNITS, aBackgroundStartRefreshes } from "../shared/server-units.mjs";
import { mergeEnvFile } from "../shared/env-file-merge.mjs";
import { unitEnvPath, activeEnvPath, envFileRead } from "../shared/env-local.mjs";
import { environmentFilesOf } from "./unit-environment.mjs";
import { startEnvFileOf } from "./run-requirements.mjs";

const INSTALL_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const readText = (path) => readFileSync(path, "utf8");
const readOrNull = (read, path) => { try { return read(path); } catch { return null; } };
const readCgroup = () => readOrNull(readText, "/proc/self/cgroup");

/**
 * This process's own systemd unit and the manager that runs it, from the text of `/proc/self/cgroup`, or null.
 * cgroup v2 writes one line, `0::<path>`; v1 writes one per controller, and systemd's is `N:name=systemd:<path>`.
 * A path through `user@<uid>.service` is the user's manager, and one under `/system.slice/` is the system's.
 * Null when no line names a service unit under either. PURE.
 */
export function ownUnit(cgroupText) {
  for (const line of String(cgroupText ?? "").split("\n")) {
    const m = /^\d+:(?:name=systemd)?:(\/\S*)$/.exec(line.trim());
    if (!m) continue;
    const unit = /\/([^/]+\.service)$/.exec(m[1])?.[1];
    if (!unit) continue;
    if (/\/user@\d+\.service\//.test(m[1])) return { manager: "user", unit };
    if (m[1].startsWith("/system.slice/")) return { manager: "system", unit };
  }
  return null;
}

/** A unit's declared systemd Type, lowercased; `simple` when the text says none. */
const unitType = (text) => (String(text ?? "").match(/^Type=(\w+)/m)?.[1] ?? "simple").toLowerCase();

/**
 * How this process runs. `missing` is the order-time rows the install lacks (run-requirements.mjs). Returns one
 * of the states in this file's header:
 *   { kind: "launcher", file, units, noLineYet, launcherFile }   `noLineYet`: no missing setting has a line in
 *       `file`, by the merge's own rule, under which a `NAME=` line counts as present even when empty.
 *       `launcherFile` is the install's settings file a background start adds from, or null when there is none
 *       separate from `file`: then that start adds from the environment it runs in.
 *   { kind: "units", file, units }
 *   { kind: "service" }
 *   { kind: "start" }
 *   { kind: "hand", file }   `file` is the settings file this process reads, or null when it reads none.
 * `units` is the installed product units that run continuously, the ones to restart.
 */
export function howItRuns({ missing = [], env = process.env, argv = process.argv, home = homedir(), repoRoot = INSTALL_ROOT,
  cgroup = readCgroup, readFile = envFileRead, exists = existsSync, read = readText,
  template = (u) => readOrNull(readText, join(repoRoot, "driver", "systemd", u)) } = {}) {
  if (String(env?.INVOCATION_ID ?? "").trim()) {
    const own = ownUnit(cgroup());
    const unitDir = join(home, ".config", "systemd", "user");
    const installed = [...new Set([...SERVER_INSTALL_SET, ...SERVER_UNITS])].filter((u) => exists(join(unitDir, u)));
    if (own?.manager !== "user" || !installed.includes(own.unit)) return { kind: "service" };
    const texts = Object.fromEntries(installed.map((u) => [u, readOrNull(read, join(unitDir, u))]));
    const units = installed.filter((u) => unitType(texts[u]) !== "oneshot");
    const launcher = aBackgroundStartRefreshes(SERVER_UNITS.filter((u) => installed.includes(u)))
      && installed.filter((u) => SERVER_INSTALL_SET.includes(u))
        .every((u) => texts[u] !== null && texts[u] === template(u));
    if (launcher) {
      const file = unitEnvPath({ home });
      let text = "";
      let known = true;
      try { text = read(file); } catch (e) { if (e?.code !== "ENOENT") known = false; }
      const names = missing.flatMap((r) => r.anyOf ?? [r.name]);
      const noLineYet = known && names.every((n) => mergeEnvFile(text, { [n]: "x" }).added.includes(n));
      const settings = activeEnvPath({ repoRoot, home });
      return { kind: "launcher", file, units, noLineYet, launcherFile: settings !== file && exists(settings) ? settings : null };
    }
    const files = new Set();
    for (const u of installed) {
      const named = texts[u] === null ? null : environmentFilesOf(texts[u], home);
      if (!named || named.length !== 1) return { kind: "service" };
      files.add(named[0]);
    }
    return files.size === 1 ? { kind: "units", file: [...files][0], units } : { kind: "service" };
  }
  if (startEnvFileOf(argv)) return { kind: "start" };
  return { kind: "hand", file: readFile() ?? null };
}
