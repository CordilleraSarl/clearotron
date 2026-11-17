// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// portal-routes/config.mjs — the settings surface, /portal/api/config/*, which reaches the profile service only through
// portal-upstream, the one tenancy wall in front of it.
//
// One of the portal service's route groups, moved out of its dispatcher unchanged; makePortalService says how it asks them.
import { assertPrincipal } from "../portal-access.mjs";

export async function configRoutes({ audit, upstream }, { method, parts, principal, body, query }) {
  // ── /portal/api/config/* — the settings surface ────────────────────────────────────────────
  // Every route here goes through portal-upstream, which is the ONLY tenancy wall in front of
  // profile-service. Nothing in this block resolves an account itself; doing so would create a
  // second implementation of tenancy that has to agree with the first one forever.
  if (parts[1] === "api" && parts[2] === "config") {
    // THE DOOR FIRST — before the wiring check, before the method check, before anything whose
    // answer depends on what this deployment happens to have.
    //
    // This block used to answer 405 method_not_allowed to a caller who had not been admitted at all:
    // POST /portal/api/config/profile from an unenrolled address returned a crisp "that endpoint
    // exists and you used the wrong verb on it", from the one surface that reads and writes tenant
    // configuration. GET on the same path already 403'd (the door check happens inside
    // portal-upstream's resolveAccount), so the surface answered two different ways to the same
    // stranger depending only on the method — and the chattier answer was the one no identity check
    // had run in front of.
    //
    // Now every method behaves identically for an unadmitted identity: the same PortalDeny(403) the
    // rest of the API gives, carrying nothing this caller could not already read off /portal/api/me.
    // 403-at-the-door is the deliberate doctrine here (portal-access.mjs: "an unmapped identity gets
    // NO principal (403 at the door)") and it is what the denial page in makeHttpHandler exists to
    // render; 404 is the doctrine for FOREIGN and NONEXISTENT resources, which is the case handled
    // on the method line below.
    assertPrincipal(principal, { door: true });
    // 404 WITH A NAMED REASON. The status is unchanged and deliberately so —
    // `portal-service.test.mjs` pins "never a 500" for this branch, and a config surface that failed
    // to construct is a clean refusal rather than a fault. What changes is the BODY: `not_found` was
    // the only thing the client had, so the screens rendered "Projects are not available to you" to
    // the owner of the account when the real cause was that `PROFILE_REPO_ROOT` does not contain the
    // customer store. That reason existed only in a boot log, and it cost the owner a morning.
    //
    // The 404-never-403 rule is untouched, and this code cannot weaken it. The rule protects the
    // EXISTENCE of tenant-scoped resources from probing; this answer is tenant-INDEPENDENT — every
    // admitted identity on this deployment gets exactly it, so it separates no account from any
    // other. The door check above still answers 403 first, so an unadmitted caller never reaches
    // this line. A 503 was the other candidate and was rejected: it would have reversed a pinned
    // contract for nothing the reader gains, and it says "try again later" about a condition that
    // needs a configuration change.
    if (!upstream) return { status: 404, json: { error: "config_surface_unavailable" } };
    const acct = query.account ?? body.account ?? null;

    // /portal/api/config/profile
    if (parts[3] === "profile" && parts.length === 4) {
      if (method === "GET") return await upstream.getProfile(principal, acct);
      // 404, not 405 — the 404-never-403 rule applied to SHAPE as well as ownership. A foreign
      // account already reads here as not-found (portal-upstream rule 2), so answering
      // method_not_allowed for a wrong verb made ONE endpoint distinguishable from an endpoint that
      // does not exist, which is precisely the fact the 404 rule is protecting. The other half of
      // this same block has always fallen through to the not_found below for the identical mistake
      // (a POST to /portal/api/config/projects) — the two halves disagreed, and this was the wrong
      // half. Byte-identical body, so nothing downstream can tell them apart either.
      return { status: 404, json: { error: "not_found" } };
    }
    // /portal/api/config/profile/{validate,save}
    if (parts[3] === "profile" && parts.length === 5 && method === "POST") {
      const r = await upstream.writeProfile(principal, acct, parts[4], body);
      if (parts[4] === "save" && r.status === 200) {
        audit({ event: "profile-save", by: principal.email, account: r.json?.account ?? acct });
      }
      return r;
    }
    // /portal/api/config/companies — CREATE. No account segment, because there is no account yet.
    //
    // It does not hang off `profile` for a reason worth stating: every route under that word acts on
    // ONE company, resolved from the caller, and this one is the act of there not being one. Reusing
    // the noun would put "the company you are in" and "the company you are making" behind the same
    // path, which is the conflation the pick panel exists to remove.
    //
    // The audit row is written upstream by the create route itself, in the same commit as the file,
    // so there is none here. An audit call copied from its neighbours would also be wrong twice: it
    // would test `status === 200` against a 201, and file nothing.
    if (parts[3] === "companies") {
      if (parts.length === 4 && method === "POST") return await upstream.createCompany(principal, body);
      // 404 for a wrong verb, as the profile branch above explains at length: 405 would make this
      // endpoint distinguishable from one that does not exist.
      return { status: 404, json: { error: "not_found" } };
    }
    // /portal/api/config/projects[/:project[/{validate,save}]]
    if (parts[3] === "projects") {
      if (parts.length === 4 && method === "GET") return await upstream.listProjects(principal, acct);
      if (parts.length === 5 && method === "GET") return await upstream.getProject(principal, acct, parts[4]);
      if (parts.length === 6 && method === "POST") {
        const r = await upstream.writeProject(principal, acct, parts[4], parts[5], body);
        if (parts[5] === "save" && r.status === 200) {
          audit({ event: "project-save", by: principal.email, account: acct, project: parts[4] });
        }
        return r;
      }
    }
    // /portal/api/config/searches[/:slug[/{validate,save}]] — saved searches, client-authorable.
    // Same shape as projects because it is the same discipline: list, read one, validate, save.
    // Archive is a save carrying archived:true; there is no delete verb to mount.
    if (parts[3] === "searches") {
      if (parts.length === 4 && method === "GET") return await upstream.listSearches(principal, acct);
      if (parts.length === 5 && method === "GET") return await upstream.getSearch(principal, acct, parts[4]);
      if (parts.length === 6 && method === "POST") {
        const r = await upstream.writeSearch(principal, acct, parts[4], parts[5], body);
        if (parts[5] === "save" && r.status === 200) {
          audit({ event: "saved-search-save", by: principal.email, account: acct, slug: parts[4],
            version: r.json?.version ?? null, archived: Boolean(body?.recipe?.archived) });
        }
        return r;
      }
    }
    return { status: 404, json: { error: "not_found" } };
  }

  return undefined;
}
