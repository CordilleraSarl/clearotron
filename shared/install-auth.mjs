// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// install-auth.mjs — which auth values the units will refuse to start without, on THIS install.
//
// ── why this exists (tracker issue 133) ─────────────────────────────────────────────────────────────
//
// From the fresh-user documented-install walk: a reader who does everything the document asks gets two
// of four units dead. With auth enabled the portal refuses without `CLEAROTRON_OIDC_AUDIENCE` plus
// `CF_ACCESS_TEAM` or `PORTAL_OIDC_ISSUER`, and the ops face refuses without `CLEAROTRON_OIDC_AUDIENCE`
// plus `CF_ACCESS_TEAM` or `TRADEMARK_MCP_OIDC_ISSUER`.
//
// Fail-closed is CORRECT and is not what this changes. The defect is that `render-units --apply`
// enumerated exactly nine values and NO auth variable was among them — and counted across the
// documents, `PORTAL_OIDC_ISSUER` appears in none of them and `TRADEMARK_MCP_OIDC_ISSUER` only in
// SECURITY.md, off the install path. The install never named what it needed.
//
// AUTH IS ON BY DEFAULT ON BOTH FACES, which is why this bites the documented path rather than an
// exotic one: an unset mode is the auth-proxy branch, not a local one. A hosted operator who sets no
// mode gets exactly the refusal above.
//
// ── THE LADDER IS DUPLICATED HERE, AND AN ARM HOLDS IT TO THE ORIGINALS ─────────────────────────────
//
// These conditions live in `driver/portal-service.mjs` and `mcp-server/http-server.mjs`, and a copy of
// a rule drifts from it. Rather than pretend otherwise, `install-census.mjs`'s `valuesRefusedOver`
// reads the real refusal lines out of those modules, and an arm asserts every name below still appears
// in the module it is claimed for. A ladder that changes without this file reds that arm.
const TRIM = (v) => String(v ?? "").trim();
const SET = (env, k) => TRIM(env?.[k]).length > 0;

/**
 * The mode the portal will run in, read exactly as `portal-service.mjs` reads it.
 *
 * UNSET IS `auth-proxy`, NOT `local` — the default is the fail-closed one, and getting this backwards
 * would make this whole module report a clean install on the box the issue was filed about.
 */
export function portalAuthMode(env = {}) {
  const m = TRIM(env.PORTAL_AUTH_MODE).toLowerCase();
  if (!m) return "auth-proxy";
  if (m === "local") return "local";
  if (m === "auth-proxy" || m === "cf-access") return "auth-proxy";
  return "invalid";
}

/** The mode the ops face will run in, read exactly as `http-server.mjs` reads it. */
export function faceAuthMode(env = {}) {
  const m = TRIM(env.TRADEMARK_MCP_AUTH_MODE).toLowerCase();
  if (m === "token") return "token";
  if (m && m !== "cf-access") return "invalid";
  if (TRIM(env.TRADEMARK_MCP_AUTH_DISABLED) === "1") return "disabled";
  return "auth-proxy";
}

/**
 * What each face needs, given the mode it will actually run in.
 *
 * `all` must every one be set; `oneOf` needs any one. The two are kept apart because "one of two
 * alternatives" is the shape a flat required-list gets wrong — it would report `PORTAL_OIDC_ISSUER`
 * missing on a correctly configured Cloudflare install.
 */
export function authRequirements(env = {}) {
  const rows = [];
  const portal = portalAuthMode(env);
  if (portal === "auth-proxy") {
    rows.push({ unit: "clearotron-portal.service", mode: "auth-proxy", source: "driver/portal-service.mjs",
      all: ["CLEAROTRON_OIDC_AUDIENCE"], oneOf: ["CF_ACCESS_TEAM", "PORTAL_OIDC_ISSUER"] });
    rows.push({ unit: "clearotron-portal.service", mode: "auth-proxy", source: "driver/portal-service.mjs",
      all: [], oneOf: ["MCP_ALLOWED_EMAIL_DOMAINS", "MCP_ALLOWED_EMAILS"] });
  } else if (portal === "local") {
    rows.push({ unit: "clearotron-portal.service", mode: "local", source: "driver/portal-service.mjs",
      all: ["PORTAL_LOCAL_USER"], oneOf: [] });
  }
  // Both portal modes refuse without a grants file, and it is not an auth-mode question.
  rows.push({ unit: "clearotron-portal.service", mode: portal, source: "driver/portal-service.mjs",
    all: ["CLEAROTRON_ACCESS_FILE"], oneOf: [] });

  const face = faceAuthMode(env);
  if (face === "auth-proxy") {
    rows.push({ unit: "clearotron-mcp-face.service", mode: "auth-proxy", source: "mcp-server/http-server.mjs",
      all: ["CLEAROTRON_OIDC_AUDIENCE"], oneOf: ["CF_ACCESS_TEAM", "TRADEMARK_MCP_OIDC_ISSUER"] });
    rows.push({ unit: "clearotron-mcp-face.service", mode: "auth-proxy", source: "mcp-server/http-server.mjs",
      all: [], oneOf: ["MCP_ALLOWED_EMAIL_DOMAINS", "MCP_ALLOWED_EMAILS"] });
  } else if (face === "token") {
    rows.push({ unit: "clearotron-mcp-face.service", mode: "token", source: "mcp-server/http-server.mjs",
      all: ["TRADEMARK_MCP_ALLOWED_HOSTS", "CLEAROTRON_ACCESS_FILE"], oneOf: [] });
  }
  return rows;
}

/**
 * The values this install has not got, for the modes it will actually run in.
 *
 * @returns {{gaps: object[], modes: {portal: string, face: string}}}
 */
export function authGaps(env = {}) {
  const gaps = [];
  for (const r of authRequirements(env)) {
    const missingAll = r.all.filter((k) => !SET(env, k));
    const oneOfUnmet = r.oneOf.length > 0 && !r.oneOf.some((k) => SET(env, k));
    if (missingAll.length || oneOfUnmet) gaps.push({ ...r, missingAll, oneOfUnmet });
  }
  return { gaps, modes: { portal: portalAuthMode(env), face: faceAuthMode(env) } };
}

/** What `--apply` prints. Names the mode first, because the mode is why the list is what it is. */
export function describeAuthGaps({ gaps, modes }, envFile) {
  if (!gaps.length) {
    return [`  auth: portal=${modes.portal}, ops face=${modes.face} — every value those modes refuse to start `
      + "without is set."];
  }
  const out = [
    "",
    `  AUTH VALUES THIS INSTALL HAS NOT GOT (portal=${modes.portal}, ops face=${modes.face}).`,
    "  These units are placed and will REFUSE TO START until the values below are set. That refusal is",
    "  correct and fail-closed; naming them here is what was missing.",
  ];
  for (const g of gaps) {
    for (const k of g.missingAll) out.push(`      ${g.unit}  needs  ${k}`);
    if (g.oneOfUnmet) out.push(`      ${g.unit}  needs one of  ${g.oneOf.join("  or  ")}`);
  }
  out.push(`  Set them in ${envFile} and run this again.`);
  if (modes.portal === "auth-proxy") {
    out.push("  Or run the portal with PORTAL_AUTH_MODE=local — one passphrase on loopback, which is the");
    out.push("  documented way to bring a first install up before an identity provider is in front of it.");
  }
  return out;
}

// ── WHAT PUTS SOMETHING IN FRONT OF A DOOR ───────────────────────────────────────────────────────────
//
// A different question from the one above, and kept apart from it deliberately: `authRequirements`
// answers "what will this unit refuse to start without", which includes values that say nothing about
// what is in front of it — a grants file, a local passphrase user, an allowed-domain list. This answers
// "does something OUTSIDE this deployment resolve to these port numbers", which is the only question a
// launcher may move a door on.
//
// Every name here is an alternative in some door's `oneOf`: a Cloudflare Access team, or that door's own
// OIDC issuer. The AUDIENCES are deliberately absent — they are `all` entries, not alternatives, and an
// audience set with neither a team nor an issuer refuses to start on every face, so it can never be the
// only evidence of a proxy.
//
// THE CLIENT DOOR HAS ITS OWN ISSUER SPELLING and it is not legacy: `mcp-server/http-server-client.mjs`
// reads `CLIENT_MCP_OIDC_ISSUER || TRADEMARK_MCP_OIDC_ISSUER`, and its fail-closed admits a start on the
// client spelling alone with no team set. A deployment fronting only its client door that way once read
// as unfronted here, which is the state that would have moved a door behind a proxy addressed to the old
// number — up, and unreachable.
//
// An arm holds this list to the doors themselves rather than to this comment: it reads the entrypoints
// `bin/start.mjs` spawns and asserts every team-or-issuer name they read appears below.
export const FRONTING_VARIABLES = Object.freeze([
  "CF_ACCESS_TEAM",
  "PORTAL_OIDC_ISSUER",
  "TRADEMARK_MCP_OIDC_ISSUER",
  "CLIENT_MCP_OIDC_ISSUER",
]);

/**
 * The fronting values this environment has set — empty means nothing outside resolves to these doors.
 *
 * @returns {string[]} the names that are set, in the order above
 */
export const frontingVariablesSet = (env = {}) => FRONTING_VARIABLES.filter((k) => SET(env, k));
