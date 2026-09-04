// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// door-posture.mjs — WAS THIS DOOR'S AUTH MODE DECLARED, OR INHERITED FROM ANOTHER DOOR'S VARIABLES?

//
// The ops MCP face came up demanding an auth-proxy JWT on a loopback listener with nothing proxying it,
// logged its posture once, reported healthy, and 401'd every caller for four and a half hours. The
// harness answered `REFUSED R2` and `0 job(s) queued`, and only a boot line said why.
//
// ── WHY THERE IS NO "REFUSE TO START" HERE, WHICH IS WHAT THE ISSUE ASKED FOR FIRST ──────────────────
//
// The issue's first branch — refuse when an auth-proxy mode meets a loopback-only listener — cannot be
// built, because "is there a proxy in front" is NOT OBSERVABLE FROM INSIDE THE LISTENER. Loopback plus
// an auth proxy is this product's own correct posture: the test box and production both bind 127.0.0.1
// behind a Cloudflare tunnel (docs/architecture/05-config-governance.md), and the shipped ingress
// example forwards to a loopback port. A refusal keyed on that shape would refuse the configuration we
// ship. The issue sanctions the alternative — report it — and that is what this module feeds.
//
// ── WHAT IS OBSERVABLE, AND IS THE ACTUAL DEFECT ────────────────────────────────────────────────────
//
// `TRADEMARK_MCP_AUTH_MODE` unset falls through to the cf-access branch, which then satisfies itself
// from `CF_ACCESS_TEAM` / `CLEAROTRON_OIDC_AUDIENCE` — the PORTAL's variables in the shared `~/.env`.
// So one door's configuration decides another's, which is exactly what the issue's second criterion
// forbids. Whether the mode was DECLARED is observable, always, and needs no knowledge of the network.
//
// An EMPTY value is the dangerous spelling and is treated as undeclared here for the same reason the
// reader does: `(process.env.X || "")` makes `X=` and an absent X indistinguishable downstream, while
// `bin/start.mjs`'s add-only env merge treats `X=` as ALREADY PRESENT and therefore does not write the
// correct value over it. An absent name is safe; a name present with no value is the one that bites.

/** Declared means: set, and not the empty string. Everything else is inherited from the default. */
export const isDeclared = (raw) => typeof raw === "string" && raw.trim() !== "";

/**
 * The host out of one `allowedHosts` entry.
 *
 * A NAIVE SPLIT ON ":" IS WRONG FOR IPv6 and answers the empty string for `::1`, which then matches no
 * loopback name and reports a loopback-only door as reachable — the failure this whole module is about,
 * inverted. Three spellings, and the bracket form is the one a host:port list actually carries.
 */
export function hostOf(entry) {
  const raw = String(entry ?? "").trim();
  if (raw.startsWith("[")) return raw.slice(1, raw.indexOf("]") === -1 ? undefined : raw.indexOf("]")).toLowerCase();
  const colons = (raw.match(/:/g) ?? []).length;
  if (colons === 1) return raw.slice(0, raw.indexOf(":")).toLowerCase();
  // Zero colons is a bare host; more than one and unbracketed is a bare IPv6 address with no port.
  return raw.toLowerCase();
}

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "0:0:0:0:0:0:0:1"]);

/**
 * Every allowedHosts entry points at loopback — nothing off this box can reach the listener directly.
 *
 * An EMPTY list is NOT loopback-only. The server refuses to start with no allowedHosts at all (DNS
 * rebinding protection would be off), so an empty population here describes a door that does not exist,
 * and answering "yes" for it is the pass-by-omission an empty set always invites.
 */
export function loopbackOnly(allowedHosts) {
  const hosts = (allowedHosts ?? []).map(hostOf).filter(Boolean);
  return hosts.length > 0 && hosts.every((h) => LOOPBACK_HOSTS.has(h));
}

/**
 * PURE. What this door should SAY about its own posture, and what health should record.
 *
 * @param {object} o
 * @param {string|undefined} o.declaredMode  the raw TRADEMARK_MCP_AUTH_MODE, exactly as the env holds it
 * @param {string} o.effectiveMode           the mode actually in force ("token" | "cf-access" | "disabled")
 * @param {string[]} o.allowedHosts
 * @returns {{state: "pass"|"warn", inherited: boolean, message: string, bootNote: string|null}}
 */
export function doorPostureVerdict({ declaredMode, effectiveMode, allowedHosts = [] }) {
  const declared = isDeclared(declaredMode);
  const loopback = loopbackOnly(allowedHosts);

  if (declared) {
    return { state: "pass", inherited: false, bootNote: null,
      message: `auth mode "${effectiveMode}" was DECLARED for this door (TRADEMARK_MCP_AUTH_MODE), so no other door's `
        + `configuration decides it.` };
  }

  // Undeclared and NOT the proxy door: the default was not reached, so nothing was inherited.
  if (effectiveMode !== "cf-access") {
    return { state: "pass", inherited: false, bootNote: null,
      message: `auth mode "${effectiveMode}" is in force and was not inherited from the auth-proxy default.` };
  }

  const note = "TRADEMARK_MCP_AUTH_MODE is not declared for this door, so it fell through to the auth-proxy "
    + "default and is satisfying itself from CF_ACCESS_TEAM / CLEAROTRON_OIDC_AUDIENCE — variables the PORTAL "
    + "owns. This door's posture is being decided by another door's configuration. Declare it explicitly in the "
    + "environment file (TRADEMARK_MCP_AUTH_MODE=token for a key door with no proxy, =cf-access for a fronted "
    + "one). An EMPTY value counts as undeclared here and is worse than an absent one: `clearotron start` treats "
    + "the name as already present and will not write the correct value over it.";

  return { state: "warn", inherited: true, bootNote: note,
    message: loopback
      // The 1980 shape exactly. Not a refusal: a tunnel terminating at this loopback port is a correct
      // and shipped deployment, and this process cannot tell that apart from nothing being in front.
      ? `${note} The listener is LOOPBACK-ONLY (allowedHosts=[${allowedHosts.join(", ")}]), so unless a proxy `
        + `terminates at this port every caller gets 401 while the service reads active and healthy — the state `
        + `that cost the suite 4.5 hours. Confirm the ingress reaches THIS port, or declare token mode.`
      : note };
}
