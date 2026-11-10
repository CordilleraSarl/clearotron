// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// portal-routes/runs.mjs — the runs list a reader sees, and acknowledging a run that needed attention.
//
// One of the portal service's route groups, moved out of its dispatcher unchanged; makePortalService says how it asks them.
import { assertPrincipal, genericOrgOf, seesEverything } from "../portal-access.mjs";
import { ACKNOWLEDGEABLE, readAcks, setAck, withAcks } from "../portal-acks.mjs";
import { forRole, scanAccountRuns, scanAllRuns } from "../portal-runs.mjs";

export async function runsRoutes({ poolRoot, workspaceRoot, queueDirs }, { method, parts, principal, body, query }) {
  // /portal/api/runs
  if (parts[1] === "api" && parts[2] === "runs" && method === "GET") {
    // — THE VIEWER'S OWN DISMISSALS, stamped per request because the listing does not know who
    // is asking and must not learn: scanAccountRuns is shared with the staff index and the fold, and
    // a per-reader flag computed inside it would be one reader's preference baked into a cache every
    // other surface reads. So the scan answers "what is there" and this answers "what has THIS
    // reader put down". Every branch below goes through it — a route that stamped only the scope=mine
    // path would leave the same run acknowledged on one screen and not on another.
    const mine = (runs) => withAcks(runs, readAcks(poolRoot, principal?.email));
    // "All brand owners". ONLY FOR A PERSON WHO SEES EVERYTHING, and it is a distinct code path rather
    // than a wildcard passed to assertPrincipal — nobody else may reach a branch that skips the account
    // resolution, even by accident. Anyone else who asks for it gets the same 404 as any account not theirs.
    if (query.account === "*") {
      // THE DOOR FIRST. This branch once read a field off `principal` directly, and `principal` is null
      // for an identity with no access anywhere — the exact caller this route most needs to refuse.
      // Reading a field off null threw a TypeError, which is not a PortalDeny, so the
      // catch at the bottom of route() rethrew it and the handler answered 500 "internal". An
      // unenrolled prober therefore got a SERVER ERROR from the one route that lists every customer,
      // while every other surface refused them cleanly — and a 500 is both the wrong answer and a
      // more interesting one than a refusal. Resolving the principal before checking whether there
      // IS one is the bug; the fix is ordering, not a null-guard.
      //
      // door:true is the same admission check /portal/api/me makes and deliberately resolves NO
      // account (portal-access.mjs), so the staff-only rule below is untouched: a client still gets
      // the plain 404 on the line after this one.
      assertPrincipal(principal, { door: true });
      if (!seesEverything(principal)) return { status: 404, json: { error: "not_found" } };
      // One pass over the pool, not one request per account. The alternative — the browser fanning
      // out across the roster — would spend a roster-sized chunk of the 120/min rate limit on every
      // poll, which is exactly what the limiter is there to stop.
      return { status: 200, json: { account: "*", runs: mine(forRole(scanAllRuns({ poolRoot, workspaceRoot, queueDirs: queueDirs() }), principal)) } };
    }

    // ?scope=mine — EVERY BRAND OWNER THIS IDENTITY HOLDS, in one call.
    //
    // Home is account-scoped: it shows what is in flight across every brand owner the account
    // holds, and the sidebar's brand-owner switcher must not empty it. A law firm clearing for
    // three of its own clients cannot have that while "all of mine" costs one request per owner
    // against a 120/min limit.
    //
    // IT IS DELIBERATELY NOT `account=*`. The wildcard means one thing — every account in the
    // deployment, staff only — and it stays that way. Letting a client's `*` quietly resolve to
    // "mine" would teach the browser that `*` is a harmless default worth sending everywhere, and
    // the next path that forgets to re-check it becomes a cross-tenant read. Two capabilities,
    // two names. (The two portal-service tests that pin the wildcard say exactly this.)
    //
    // One request shape for everyone: staff get every account, a client gets its own. Home never
    // has to ask who is looking, which is the whole point — there is no staff layout.
    if (parts[1] === "api" && parts[2] === "runs" && method === "GET" && query.scope === "mine") {
      assertPrincipal(principal, { door: true });
      if (seesEverything(principal)) {
        return { status: 200, json: { account: "*", runs: mine(forRole(scanAllRuns({ poolRoot, workspaceRoot, queueDirs: queueDirs() }), principal)) } };
      }
      // Resolved from `principal.accounts`, NEVER from the query — this is the same set
      // assertPrincipal hands back one key at a time, so it widens no boundary.
      //
      // `accounts === "*"` is the grants-file-absent posture (enforcement OFF). That is a
      // SENTINEL, NOT A LIST: expanding it here would turn a missing config file into a
      // cross-tenant read, so it falls through to the same refusal as holding nothing.
      // Their companies, and the Generic of each organisation they hold whole.
      if (Array.isArray(principal.accounts) && (principal.accounts.length || principal.genericOrgs?.length)) {
        return { status: 200, json: { account: "*", runs: mine(forRole(scanAccountRuns({ poolRoot, workspaceRoot, account: principal.accounts,
          generic: { orgs: principal.genericOrgs ?? [] }, queueDirs: queueDirs() }), principal)) } };
      }
      return { status: 404, json: { error: "not_found" } };
    }
    const account = assertPrincipal(principal, { account: query.account ?? null, tenant: query.tenant ?? null });
    if (!account) return { status: 400, json: { error: "name an account (?account=)" } };
    // GENERIC IS LISTED PER ORGANISATION. assertPrincipal has already refused an organisation whose
    // Generic this person does not see. A named or implied organisation lists its own Generic runs,
    // and a person who sees everything also gets the ones filed under none — on a one-organisation
    // install those are that organisation's. Unnamed, with several organisations, a person who sees
    // everything lists every Generic run, which is what they saw before organisations existed.
    if (account === "generic") {
      const org = genericOrgOf(principal, query.tenant ?? null);
      const generic = org == null ? { all: true } : { orgs: [org], unfiled: seesEverything(principal) };
      return { status: 200, json: { account, tenant: org, runs: mine(forRole(scanAccountRuns({ poolRoot, workspaceRoot, account: [], generic, queueDirs: queueDirs() }), principal)) } };
    }
    return { status: 200, json: { account, runs: mine(forRole(scanAccountRuns({ poolRoot, workspaceRoot, account, queueDirs: queueDirs() }), principal)) } };
  }
  // ── /portal/api/ack — "I have seen that one" ─────────────────────────────────────────────
  //
  // The Home dashboard accumulated failed runs with no way to clear them; on the test instance they
  // were the dominant content, crowding out the work actually running. This dismisses one, FOR THE
  // VIEWER ONLY.
  //
  // NOT STAFF-GATED, and that is the point rather than an oversight — it is the one curation act on
  // this service that changes nothing anybody else can see, so every reader gets it for their own
  // dashboard. Compare /portal/admin/retired: that hides a run from everyone including the
  // brand owner, so it is staff-only and audited. This is neither, because there is nothing to
  // audit: no state moves, no other reader is affected, and the run is untouched in Clearances.
  //
  // NO OWNERSHIP SCAN. Acking an id you cannot see writes one line to your own file and matches
  // nothing on any listing you can reach — the stamp is applied by comparing against rows the scan
  // already decided you may have. Proving ownership here would put a pool walk on a click, to
  // prevent a caller from filling their own 500-entry file with ids that do nothing. The id is
  // shape-checked all the same: it is a key in a file we write.
  if (parts[1] === "api" && parts[2] === "ack" && method === "POST") {
    assertPrincipal(principal, { door: true });
    const runId = String(body?.runId ?? "");
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,180}$/.test(runId) || runId.includes("..")) {
      return { status: 400, json: { error: "unknown run" } };
    }
    const acknowledged = body?.acknowledged !== false;
    const state = String(body?.state ?? "");
    // The rule at the door as well as in the key: a paused or recovering run is one somebody still
    // needs to see. Keying on (runId, state) already makes a lie inert — the stamp only lands while
    // the run still reads that way — but a refusal here is what a caller can act on.
    if (acknowledged && !ACKNOWLEDGEABLE.includes(state)) {
      return { status: 400, json: { error: `only a ${ACKNOWLEDGEABLE.join(" or ")} run can be acknowledged` } };
    }
    const acks = setAck(poolRoot, principal.email, { runId, state, acknowledged });
    return { status: 200, json: { acknowledged, runId, count: acks.size } };
  }
  return undefined;
}
