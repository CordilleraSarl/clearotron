// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// unit-environment.mjs — what the UNITS' environment holds, as opposed to the operator's shell.
//
// ── THE OUTCOME THIS EXISTS TO STOP ─────────────────────────────────────────────────────────────────
//
// `clearotron doctor` on a correctly-running install ended with two problems, and BOTH WERE FALSE:
//
//     ✗ PORTAL_MCP_URL is not set for the units, so the portal's Start button has no engine to call —
//       a clearance submitted here returns 502 while every other check passes.
//     ✗ the client door is HALF configured — account access (CLIENT_MCP_ACCOUNT_ACCESS) is off.
//
// The units load `EnvironmentFile=%h/.env`, and that file held both values. The running service's own
// log agreed. `--background` had written them minutes earlier — so the first message asserted that the
// only thing which writes the value had not written it, immediately after it did.
//
// The cause is a mismatch between WHAT IS READ and WHAT IS CLAIMED. `doctor` reads the environment of
// the shell it was typed in; the units read `%h/.env` with CLEAROTRON_NO_ENV_FILE=1, which severs
// inheritance on purpose, so their environment is a DIFFERENT SET. Reading one and asserting about the
// other is not a near-miss — on a hosted box the two are unrelated by construction.
//
// ── AN ABSENCE IS A FINDING, AND THIS MODULE IS WHERE THAT NEARLY INVERTED ──────────────────────────
//
// The discipline is everywhere in this codebase, and `doctor` managed to invert it: it reported PRESENCE
// as ABSENCE and handed an operator two faults that did not exist, one of which told them a working
// install returns 502 on every clearance. The next honest thing it prints will be believed less.
//
// So every answer here is THREE-VALUED, the same contract as driver/test/platform-caps.mjs `pidAlive`:
//
//   set     — the units carry this name, and here is its value.
//   unset   — the units were read, and this name is genuinely absent. A real finding.
//   unknown — the units could not be read. NEVER reported as "not set", because a reader that failed
//             knows nothing, and "not set" is an assertion about the world rather than about the read.
//
// PURE. It opens no file and knows no path: the caller injects the unit text and the env-file text, so
// every branch — including the ones a developer box cannot produce — is drivable from a test.

import { parseEnvFile } from "./systemd/render-units.mjs";

/** systemd's own name for "load this file, and do not fail if it is missing". */
const OPTIONAL = "-";

/**
 * Expand the systemd specifiers we actually understand, and REFUSE the ones we do not.
 *
 * The installed units say `EnvironmentFile=%h/.env`. A reader that passed that through unexpanded would
 * open nothing, find nothing, and — before this module existed — report every name as absent. That is
 * the F34 defect arriving by a second route, so an unexpanded specifier is a could-not-look and never a
 * silent miss: a path we cannot resolve is a hole in the picture, not an empty file.
 *
 * @returns {{path: string}|{unresolved: string}}
 */
function expandSpecifiers(raw, home) {
  const path = String(raw).replace(/%h/g, home ?? "");
  if (!home && /%h/.test(raw)) return { unresolved: raw };
  // %% is an escaped percent and is legal; anything else left over is a specifier we do not implement.
  const leftover = path.replace(/%%/g, "").match(/%[A-Za-z]/);
  return leftover ? { unresolved: raw } : { path };
}

/**
 * Merge one unit file's environment directives IN FILE ORDER.
 *
 * systemd applies `EnvironmentFile=` and `Environment=` as it encounters them, and a later assignment
 * overrides an earlier one. Reading the whole file and applying the two kinds in separate passes would
 * be a different resolution order from the one the running service got — which is exactly the class of
 * bug this module exists to close, so the order is preserved rather than approximated.
 *
 * @param {string} unitText            the unit file's contents
 * @param {(path: string) => string|null} readEnvFile  returns the file's text, or null if unreadable
 * @returns {{env: Object, missing: string[]}}  `missing` names REQUIRED files that could not be read
 */
function applyUnit(unitText, readEnvFile, home) {
  const env = {};
  const missing = [];
  for (const raw of String(unitText ?? "").split("\n")) {
    const line = raw.trim();
    // `Environment=` may carry several assignments on one line; systemd splits on whitespace.
    const direct = /^Environment=(.*)$/.exec(line);
    if (direct) {
      for (const pair of direct[1].trim().split(/\s+/)) {
        const m = /^"?([A-Za-z_][A-Za-z0-9_]*)=(.*?)"?$/.exec(pair);
        if (m) env[m[1]] = m[2];
      }
      continue;
    }
    const file = /^EnvironmentFile=(.*)$/.exec(line);
    if (file) {
      let spec = file[1].trim();
      const optional = spec.startsWith(OPTIONAL);
      if (optional) spec = spec.slice(1);
      const resolved = expandSpecifiers(spec, home);
      if (resolved.unresolved !== undefined) {
        // We cannot say what this file holds, so we must not say what it does not hold. Even when the
        // unit marked it optional, an unresolvable path is a gap in the READER, not a file systemd was
        // told it could do without.
        missing.push(`${resolved.unresolved} (unresolved systemd specifier)`);
        continue;
      }
      const path = resolved.path;
      const text = readEnvFile(path);
      if (text == null) {
        // A REQUIRED file that cannot be read is not an empty file. systemd would refuse to start the
        // unit; here it means our picture of the unit's environment has a hole, and a hole must not be
        // reported as "the name is absent".
        if (!optional) missing.push(path);
        continue;
      }
      Object.assign(env, parseEnvFile(text));
    }
  }
  return { env, missing };
}

/**
 * The environment the units actually run with.
 *
 * @param {object} a
 * @param {{name: string, text: string|null}[]} a.units  the unit files, in the order they are applied
 * @param {(path: string) => string|null} a.readEnvFile  reads an EnvironmentFile, null when unreadable
 * @returns {{known: boolean, env: Object, read: string[], why: string|null}}
 *   `known` is false when NOTHING could be read — the caller must then say "could not determine".
 */
export function unitEnvironment({ units = [], readEnvFile = () => null, home = null } = {}) {
  const present = units.filter((u) => u && typeof u.text === "string");
  if (!present.length) {
    return { known: false, env: {}, read: [],
      why: units.length
        ? "the unit files are installed but none could be read"
        : "no units are installed, so there is no unit environment to read" };
  }
  const env = {};
  const read = [];
  const holes = [];
  for (const u of present) {
    const { env: one, missing } = applyUnit(u.text, readEnvFile, home);
    Object.assign(env, one);
    read.push(u.name);
    holes.push(...missing);
  }
  if (holes.length) {
    // Partial is not whole. We read SOMETHING, but a file the units require was unreadable, so any
    // name we did not find might live in it — and reporting those as absent would be the original bug
    // with a smaller blast radius. The whole picture is refused instead.
    return { known: false, env, read,
      why: `the units require environment file(s) this command could not read: ${[...new Set(holes)].join(", ")}` };
  }
  return { known: true, env, read, why: null };
}

/**
 * One name, three-valued, against a resolved unit environment.
 *
 * The `unknown` case is the whole point and it is the one a caller is most likely to collapse. It is
 * returned as a STATE rather than a null so that `if (!value)` cannot silently mean "absent" — the
 * shape refuses the shortcut that produced the finding this module is named for.
 *
 * @returns {{state: "set"|"unset"|"unknown", value: string|null, why: string|null}}
 */
export function unitValue(resolved, name) {
  if (!resolved || resolved.known !== true)
    return { state: "unknown", value: null, why: resolved?.why ?? "the unit environment was not read" };
  const v = resolved.env?.[name];
  const trimmed = v == null ? "" : String(v).trim();
  return trimmed ? { state: "set", value: trimmed, why: null } : { state: "unset", value: null, why: null };
}

/**
 * The sentence a surface prints when it could not look.
 *
 * Shared so that three surfaces cannot invent three different ways of saying it, and so the phrase
 * "could not determine" is the one that appears — never "not set", which is the assertion F34 was
 * filed for.
 */
export function couldNotDetermine(name, resolved) {
  return `could not determine whether ${name} is set for the units — ${resolved?.why ?? "the unit environment was not read"}. `
    + "This is not a report that it is missing; it is a report that this command could not look.";
}
