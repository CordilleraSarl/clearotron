// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// Does a systemd --user manager still hold the groups its user has?
//
// ── the failure this names ────────────────────────────────────────────────────────────────────────
//
// Supplementary groups are captured when the `systemd --user` manager STARTS. Every service it spawns
// inherits that set for the manager's whole lifetime. So adding a user to a group does not reach any
// running service, and restarting the individual units does not either — only restarting
// `user@<uid>.service` re-reads them.
//
// A manager that started before its user joined a group keeps the OLD set: the manager reports
// `Groups: 1005` while `id <user>` reports `1005,1006(<group>)`. A service it spawns then cannot read a
// group-owned config store, and a health check fails with:
//
//     [ FAIL ] roster resolves
//         list_profiles failed: ERROR (list_profiles): EACCES: permission denied,
//         scandir '<profiles dir>'
//
// ── why the symptom sends you the wrong way ───────────────────────────────────────────────────────
//
// EACCES on a path whose permissions are CORRECT. The store is `drwxrws---`, group-owned, and the user
// is in that group — interactively they can read the directory. Everything visible says "permission
// problem", so the fix that suggests itself is `chmod`. That fix is wrong here, and on a set-GID
// delivery pool root it is actively harmful: a non-member chmod silently strips the set-GID bit, after
// which every report 403s. This check names the actual cause before anyone reaches for chmod.
//
// ── the verdict is a pure function ────────────────────────────────────────────────────────────────
//
// Extracted from the check for the same reason driver/roster-verdict.mjs was: a decision inside a
// top-level-await script cannot be tested, and this one has to be right in three directions — stale,
// current, and could-not-look. An absence must read as "could not look", never as agreement.

/**
 * @param {object} o
 * @param {number[]|null} o.idGroups       gids from `id -G` — what the user IS in. null = could not read.
 * @param {number[]|null} o.managerGroups  gids the running manager holds. null = no manager, or unreadable.
 * @param {string} o.user                  for the message
 * @param {number|string} o.uid            for the restart instruction
 * @param {string|null} [o.why]            why a null input is null, when the caller knows
 * @returns {{state: "pass"|"fail"|"skip", message: string}}
 */
export function managerGroupsVerdict({ idGroups, managerGroups, user, uid, why = null }) {
  // ── could not look ──────────────────────────────────────────────────────────────────────────────
  // NOT a pass. A box with no `systemd --user` manager is a legitimate shape (production runs its
  // services from system units), and so is a check running where it cannot read /proc. Both are "this
  // was not established", and saying so is the whole point — the deployment that HAD this fault also
  // had a check that reported nothing wrong.
  if (!Array.isArray(idGroups) || !idGroups.length) {
    return { state: "skip", message: `could not read the groups of ${user}${why ? ` — ${why}` : ""}. Not checked, not passed.` };
  }
  if (!Array.isArray(managerGroups)) {
    return { state: "skip", message: `no readable systemd --user manager for ${user}${why ? ` — ${why}` : ""}. `
      + `Nothing to compare, so this says nothing about the deployment either way.` };
  }

  const idSet = new Set(idGroups);
  const mgrSet = new Set(managerGroups);
  const missing = idGroups.filter((g) => !mgrSet.has(g));   // the user has it; services do NOT
  const extra = managerGroups.filter((g) => !idSet.has(g)); // services have it; the user no longer does

  if (!missing.length && !extra.length) {
    return { state: "pass", message: `${user}'s manager holds the same groups the user does (${idGroups.join(", ")})` };
  }

  const restart = `sudo systemctl restart user@${uid}.service`;
  // The message leads with the CAUSE, not the symptom, because the symptom is what misleads. It names
  // the restart target explicitly — restarting the units is the fix people try first and it does nothing.
  const lines = [];
  if (missing.length) {
    lines.push(`STALE USER MANAGER — not a file-permission problem. ${user} is in group(s) ${missing.join(", ")} `
      + `that the running systemd --user manager does NOT hold, because the manager started before they were `
      + `added and captures supplementary groups once, at start.`);
    lines.push(`Every service it spawned inherits the stale set, so a service will get EACCES on paths whose `
      + `permissions are correct. Do NOT chmod: on a set-GID tree a non-member chmod strips the bit and makes `
      + `it worse.`);
  }
  if (extra.length) {
    lines.push(`The manager still holds group(s) ${extra.join(", ")} that ${user} is no longer in, so its `
      + `services keep an access the user has lost. Same cause, opposite direction.`);
  }
  lines.push(`Fix: ${restart} — restarting the individual units does NOT refresh this.`);
  lines.push(`id: ${idGroups.join(", ")} | manager: ${managerGroups.join(", ") || "(none)"}`);
  return { state: "fail", message: lines.join(" ") };
}
