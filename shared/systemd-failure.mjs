// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// systemd-failure.mjs — a `systemctl` refusal, said in the reader's terms.
//
// ── ONE DEFINITION, BECAUSE THE SECOND CALLER HAD NONE ───────────────────────────────────────────────
//
// `connect` learned this the expensive way (tracker issue 121): its `systemctl` calls ran with
// `stdio: "ignore"`, so systemd's own explanation was thrown away before anyone could read it and the
// whole output was `connect: Command failed: systemctl --user daemon-reload`; and the session-bus remedy
// was appended to EVERY failure, so a unit that would not start for a bound port or a bad ExecStart was
// told to export XDG_RUNTIME_DIR — a confident remedy for a cause that was not the reader's, which costs
// more than no remedy at all.
//
// `start --background` never learned it. Its `enable --now` loop ran uncaught, so the same refusal
// arrived as a raw Node stack trace — `at genericNodeError (node:internal/errors:983:15)`, a status
// code, and no statement of what had happened to the install (tracker issue 203). That is the failure
// `shared/listen.mjs` was written to end one layer down, and its rule is the rule here: an unrecognised
// failure still gets a sentence and still exits non-zero; what it must not do is arrive as a stack trace
// with no statement of consequence.
//
// ── WHAT IS SHARED AND WHAT IS NOT ───────────────────────────────────────────────────────────────────
//
// The DIAGNOSIS is shared: what systemd said, whether that is a missing bus, and which remedy fits. The
// CONSEQUENCE is not, and must not be — `connect` and `start` write different things and leave the box
// in different states, and `alreadyApplied` in connect.mjs already records why even one command needs
// two answers ("true and incomplete at the first and misleading at the second"). So the caller hands in
// the sentence about its own writes, and this file never guesses it.
import { existsSync } from "node:fs";

/**
 * Does this failure say the SESSION BUS is missing, rather than anything about the unit?
 *
 * ONE AUTHORITY, because more than one reader asks it (tracker issue 130, criterion 3). The failure text
 * below offers the bus remedy on a yes, and connect's health reader refuses to translate a yes into "the
 * door is not open" — that mistranslation is the defect, and a second copy of this test is how the two
 * would come to disagree about which failures are bus failures.
 */
export function looksLikeBusFailure(said) {
  return /Failed to connect to( the)? bus|DBUS_SESSION_BUS_ADDRESS|XDG_RUNTIME_DIR|No medium found/i.test(String(said ?? ""));
}

/** What a failed `systemctl` said, preferring its own stderr over Node's wrapper message. */
export function systemdSaid(e) {
  return `${e?.stderr ?? ""}`.trim() || `${e?.message ?? e}`.trim();
}

/** What to tell a reader whose shell has no user bus — the two exports, by name. */
export function busRemedy(uid = process.getuid?.() ?? "$(id -u)") {
  return `systemctl --user needs a login session's bus, and this shell has none — which is what \`su\` and \`sudo -u\` leave you with.\n`
    + `Either log in as this user properly (\`machinectl shell\`, or ssh as them), or export the two the bus is found through:\n`
    + `  export XDG_RUNTIME_DIR=/run/user/${uid}\n`
    + `  export DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/${uid}/bus`;
}

/**
 * The environment to run `systemctl --user` in, with the bus filled in where it can be DERIVED.
 *
 * A shell entered with `su` or `sudo -i` has the runtime directory on disk and neither variable set, and
 * that is a value this process can work out rather than asking a reader to. When the directory is absent
 * there IS no user bus and no value would help — `busRemedy()` says so in words instead.
 */
export function userBusEnv(env = process.env) {
  const out = { ...env };
  if (out.XDG_RUNTIME_DIR && out.DBUS_SESSION_BUS_ADDRESS) return out;
  const dir = out.XDG_RUNTIME_DIR || `/run/user/${process.getuid?.() ?? ""}`;
  if (!existsSync(dir)) return out;             // no session: the remedy is words, not a guessed value
  out.XDG_RUNTIME_DIR = dir;
  out.DBUS_SESSION_BUS_ADDRESS ||= `unix:path=${dir}/bus`;
  return out;
}

/**
 * A systemd failure as an Error a reader can act on: the reason first, then the remedy that fits it,
 * then the caller's statement of what already stands.
 *
 * `stands` is the caller's — omitted rather than invented when it has none to give. A command that
 * changed nothing before the failure should pass nothing; a command that wrote an env file, placed
 * units and enabled three of four must say so, because the reader's real question is not that a step
 * failed but whether to run it again, undo it, or leave it alone.
 */
export function systemdFailure(e, { unit = null, stands = null } = {}) {
  const said = systemdSaid(e);
  const remedy = looksLikeBusFailure(said)
    ? busRemedy()
    : `That is not a missing session bus, so the two exports will not help. Read what systemd itself says:\n`
      + `  systemctl --user status ${unit ?? ""}`.trimEnd() + `\n  journalctl --user -u ${unit ?? "<unit>"} -n 50 --no-pager`;
  return new Error(`${said}\n\n${remedy}${stands ? `\n\n${stands}` : ""}`);
}

/** The stdio a `systemctl` call must run with for any of this to have anything to read. */
export const CAPTURE_STDERR = { stdio: ["ignore", "ignore", "pipe"], encoding: "utf8" };
