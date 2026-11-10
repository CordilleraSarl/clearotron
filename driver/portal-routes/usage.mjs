// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// portal-routes/usage.mjs — /portal/api/usage, what an account has used against its allowance.
//
// One of the portal service's route groups, moved out of its dispatcher unchanged; makePortalService says how it asks them.
import { assertPrincipal, genericOrgOf, seesEverything } from "../portal-access.mjs";
import { accountUsage, DEFAULT_CLIENT_DAILY_RUNS } from "../usage-ledger.mjs";

export async function usageRoutes({ queueDirs, upstream, loadProfilesImpl }, { method, parts, principal, query }) {
  // /portal/api/usage — what this account has used against its allowance.
  //
  // Its own route rather than a field on /portal/api/me, because it is per-ACCOUNT and `me` is
  // per-identity: a staff member acting for three clients has three different answers, and one of
  // them is never "yours". Cheap enough to fetch beside the composer and the run list.
  if (parts[1] === "api" && parts[2] === "usage" && method === "GET") {
    const account = assertPrincipal(principal, { account: query.account ?? null, tenant: query.tenant ?? null });
    if (!account) return { status: 400, json: { error: "name an account (?account=)" } };
    // Generic is counted per organisation — the lane the wall caps (runner.mjs checkRunCaps).
    const organisation = account === "generic" ? genericOrgOf(principal, query.tenant ?? null) : null;
    // Caps live on the customer profile and are code-owned (never client-editable). A deployment
    // with no config surface still answers, with counts and no caps — "we cannot tell you your
    // limit" is a better answer than a fabricated one.
    let caps = null, capsRead = false;
    if (upstream) {
      try {
        if (account === "generic") { caps = (await loadProfilesImpl()).get("generic")?.runCaps ?? null; capsRead = true; }
        else {
          const r = await upstream.getProfile(principal, account);
          if (r.status === 200) { caps = r.json?.readOnly?.runCaps ?? null; capsRead = true; }
        }
      } catch { /* a settings surface fault must not take the counter down */ }
    }
    // `complete` rides out with the counts (see usage-ledger.mjs): false means no ledger was read and
    // these numbers are a floor. The UI can render that as "—" the way it already renders an
    // unreadable cap as null, instead of a confident 0 nobody counted.
    //
    // `basis` is dropped here on purpose. What a client is owed is "we could not count", which
    // `complete` says; WHICH kind of nothing it was is an operator's diagnosis of our deployment and
    // belongs in the audit trail, where the quota pre-check puts it.
    const { basis: _basis, ...used } = accountUsage({ queueDirs: queueDirs(), account, organisation });
    return { status: 200, json: { account, ...(account === "generic" ? { tenant: organisation } : {}), ...used,
      // The EFFECTIVE daily allowance: the profile's value, else the default the wall applies — a
      // client reading "—" while the wall enforces 2 is the same lie as a wrong count. But a profile
      // we could NOT read still reports null: "we cannot tell you your limit" is a different
      // statement from "your limit is 2", and only one of them is honest when settings are down.
      dailyRuns: Number.isInteger(caps?.dailyRuns) ? caps.dailyRuns : (capsRead ? DEFAULT_CLIENT_DAILY_RUNS : null),
      monthlyRuns: caps?.monthlyRuns ?? null, maxQueued: caps?.maxQueued ?? null,
      // A person who sees everything is not capped, and the UI needs to know that to avoid showing an
      // allowance to someone it does not bind. See checkRunCaps for why it is decided here and nowhere else.
      capped: !seesEverything(principal) } };
  }

  // /portal/api/mcp-access — the connection details for driving the engine from your own assistant.
  //
  // The Use-your-AI screen shipped deliberately EMPTY: there was no API that reported a host, so the
  // page said so rather than printing a plausible placeholder (a genericised host has gone out of this
  // codebase before and had to be chased). This is that API, and it keeps the same discipline: the URL
  // comes from configuration and is null when unset. A deployment that has not wired the client MCP
  // says "not available here", which is true, instead of showing an address that will not connect.
  //
  // There is no credential in this response, and that is the design rather than an omission: client
  // MCP access is the caller's OWN Cloudflare Access login plus the grants entry that already governs
  // this portal. Nothing to mint, nothing to paste, nothing to leak — and revoking portal access
  // revokes the connector with it.
  //
  // `keyUrl` is the SECOND address: the API-key door, for assistants that cannot do a browser sign-in
  // (a fixed "API key" box, a headless agent). It is a different HOST, never the same one with a key
  // bolted on, and it is reported separately so the page can be honest about which is which. It stays
  // null until that door is deployed — and a key itself is never in this response: keys are issued to a
  // named person out of band, not handed to whoever loads the page.
  // DOOR CHECK, not an account check — and the distinction is the whole bug this once had. Nothing in
  // this answer is per-account: the connector address is one host for the deployment, and the identity
  // to sign in with is the caller's own. Asking assertPrincipal to resolve an ACCOUNT made the route
  // depend on something it never uses, and the failure was silent in the worst way — `assertPrincipal`
  // returns null for STAFF with no acting-for account (portal-access.mjs: "caller decides"), that null
  // became a 400, and the screen fell back to its "not shown here" empty state. So every staff user and
  // every multi-account client was told the connector did not exist yet, while single-account clients
  // saw it. `door:true` is the mode for exactly this question — may this identity enter — and it is what
  // /portal/api/me already uses.
  return undefined;
}
