// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// config-staleness.mjs — which running services predate the configuration they are supposed to be using.
//
// ── THE OUTCOME THIS EXISTS TO STOP ─────────────────────────────────────────────────────────────────
//
// After the F41 repair the owner restarted the worker, as instructed, and refreshed the portal. It
// showed the BUNDLED DEMO ROSTER — aurora, petcary, zephyr — and not his own account.
//
//     ~/.env repaired   10:51:16
//     worker            10:51:21   ← new config
//     portal            10:10:16   ← old config
//     mcp-face          10:10:16   ← old config
//     client-mcp        10:23:40   ← old config
//
// Three services had been running replaced configuration for forty minutes. `clearotron status`
// reported all four active/running throughout, because they WERE. Nothing anywhere said a service was
// running configuration that had since been replaced, and the only signal was a roster looking wrong in
// a screenshot, spotted by eye.
//
// A process reads its environment once, at start. So "active" and "current" are different questions and
// the product was only ever answering the first. A product that composes its own unit environment knows
// when it has changed it, which is what makes this answerable at all rather than a guess.
//
// ── EPOCHS, NEVER WALL-CLOCK STRINGS ────────────────────────────────────────────────────────────────
//
// This box prints CEST and systemd's timestamps are its own; comparing formatted strings across that
// seam is how a comparison silently inverts for one hour twice a year. Everything here is a number of
// milliseconds and the caller does the reading.
//
// PURE. It opens nothing and asks systemd nothing: the caller supplies the start times and the config
// file's mtime, so the interesting cases — including a clock that cannot be read — are drivable.

/**
 * Which units started BEFORE the configuration they load was last written.
 *
 * THREE-VALUED per unit, the same contract as the unit-environment reader and the liveness probe:
 *
 *   fresh   — started at or after the config was written. Nothing to say.
 *   stale   — started strictly before it. It is running values that have since been replaced.
 *   unknown — a start time or the config mtime could not be read. NEVER reported as fresh, because
 *             "we could not tell" and "it is current" are the two answers this whole module exists to
 *             stop being collapsed into one.
 *
 * @param {object} a
 * @param {{name: string, startedEpochMs: number|null}[]} a.units
 * @param {number|null} a.configEpochMs  mtime of the file the units load
 * @returns {{name: string, state: "fresh"|"stale"|"unknown", behindMs: number|null}[]}
 */
export function configStaleness({ units = [], configEpochMs = null } = {}) {
  return units.map(({ name, startedEpochMs = null }) => {
    if (!Number.isFinite(configEpochMs) || !Number.isFinite(startedEpochMs))
      return { name, state: "unknown", behindMs: null };
    // STRICTLY before. A unit started in the same millisecond as the write is not behind it, and an
    // off-by-one in this direction would report every freshly-restarted service as stale — a warning
    // that cries wolf gets ignored, which costs more than the silence it replaced.
    return startedEpochMs < configEpochMs
      ? { name, state: "stale", behindMs: configEpochMs - startedEpochMs }
      : { name, state: "fresh", behindMs: null };
  });
}

/** Minutes, rounded down, for a sentence a person reads. Never used for a comparison. */
export const minutesBehind = (ms) => Math.floor((ms ?? 0) / 60000);

/**
 * systemd's timestamp as an EPOCH in milliseconds, or null when it cannot be read.
 *
 * SEPARATED FROM THE SHELL-OUT ON PURPOSE. Running `systemctl` cannot be pure; INTERPRETING what it
 * prints can, and the interpretation is the half with the bug in it. Splitting them is what makes the
 * three real outputs drivable with no stub at all.
 *
 * `--timestamp=unix` prints `@<seconds>` and that is the only form this accepts. There WAS a Date.parse
 * fallback for boxes whose systemd does not know the switch, and it was DEAD: measured on systemd 255,
 * the human form is `Thu 2026-09-03 06:29:21 CEST`, and Date.parse of that is NaN because CEST is not
 * an abbreviation Node is required to know — while the same string with UTC parses fine. So the
 * fallback caught the box that needed no help and missed the only case it existed for. A fallback that
 * cannot parse the thing it was written for is a third state pretending to be a second, in a module
 * whose whole thesis is that unknown and current must not collapse. Removed rather than repaired:
 * returning null is honest, and null is already handled everywhere.
 *
 * An inactive unit prints an EMPTY value rather than `@0` — measured across six of them. That matters:
 * `@0` would have parsed to epoch zero and reported every never-started unit as stale by fifty-six
 * years, which is the cry-wolf failure the strictly-before rule exists to avoid, arriving by the other
 * door. Empty lands on null, which is correct.
 */
export function parseSystemdTimestamp(raw) {
  const s = String(raw ?? "").trim();
  const m = /^@(\d+)$/.exec(s);
  return m ? Number(m[1]) * 1000 : null;
}

/**
 * The one sentence every surface says about staleness, so two of them cannot disagree.
 *
 * It names the REMEDY, because a warning a reader cannot act on is the class this batch is about. There
 * is no reload: a process reads its environment at start, so restarting is the only thing that applies
 * a change, and saying so is more honest than implying a lighter option exists.
 */
export function stalenessWarning(stale, { restartCommand = "systemctl --user restart" } = {}) {
  const names = stale.map((s) => s.name);
  const worst = Math.max(0, ...stale.map((s) => s.behindMs ?? 0));
  return `${names.length} service(s) are RUNNING CONFIGURATION THAT HAS SINCE BEEN REPLACED`
    + `${worst ? ` — the oldest by ${minutesBehind(worst)} minute(s)` : ""}: ${names.join(", ")}. `
    + `They are active and they are serving old values; a process reads its environment once, at start, `
    + `so nothing short of a restart applies the change:  ${restartCommand} ${names.join(" ")}`;
}
