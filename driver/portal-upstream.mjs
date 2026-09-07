// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// portal-upstream.mjs — the tenancy wall in front of profile-service.
//
// profile-service ONLY. recipe-service implements a full write surface for saved searches, but it is
// loopback-only and is not proxied from the portal — so there is no recipe method here, and the Saved
// searches screen is honestly read-only rather than carrying buttons that would 404. If that surface is
// ever proxied, it needs its own tenancy treatment written deliberately; do not assume this file already
// covers it because the two services sit next to each other.
//
// ── READ THIS BEFORE CHANGING ANYTHING HERE ─────────────────────────────────────────────────────────
//
// profile-service has NO tenancy gate. None. It answers /profiles/:key for ANY key to ANY caller its
// CF Access check admits, and that was correct for its whole life so far, because the only door into
// it was the STAFF Cloudflare Access app — everyone who could reach it was allowed to see everything.
//
// The unified portal changes that premise completely: it admits CLIENTS. This module is the only thing
// standing between a signed-in client and every other client's configuration. There is no second wall
// behind it. If this file is wrong, client A reads and writes client B's profile, in production, with
// no error anywhere.
//
// Three rules follow, and each is enforced here rather than trusted to a caller:
//
//   1. THE ACCOUNT COMES FROM THE PRINCIPAL, NEVER FROM THE PATH OR THE BODY. A client cannot name an
//      account at all — theirs is substituted. Staff must name one, and it is checked against the
//      roster. There is no code path where a body field or a URL segment picks the tenant.
//
//   2. A FOREIGN ACCOUNT IS 404, byte-identical to a nonexistent one. Never 403. A 403 confirms the
//      account exists, which is exactly the fact a competitor would be probing for.
//
//   3. THE CODE-OWNED FIELDS ARE STRIPPED FROM EVERY WRITE, on the way in. profile-service preserves
//      them from disk on save, so a crafted body cannot change them there either — but relying on that
//      would make this module's safety a property of a DIFFERENT file's implementation detail. They are
//      removed here, and a test asserts a crafted body cannot move them.
//
//   4. ROLE NO LONGER SHAPES THE PROJECT LIST. It used to: archived projects were filtered out of a
//      client's view on the way OUT (2026-07-20), which was coherent while only Cordillera created a
//      project. Clients create their own now, and hiding an archived one hid the control that brings it
//      back — a one-way door on the client's own record. Both roles see the same rows; the screen greys
//      the archived ones. Tenancy is untouched: it lives in resolveAccount and rule 2, as it always did.

import { KNOWN_PROFILE_KEYS, PROJECT_KEYS } from "./profiles.mjs";
import { assertPrincipal, PortalDeny } from "./portal-access.mjs";

/**
 * The five fields the UI must never write.
 *
 * These are the customer's rating authority and run economics — which framework rates their matters,
 * which worked examples anchor it, which recipes they may run, the jurisdiction policy and the run
 * caps. They are changed in git, under review, deliberately. A settings page that could move them
 * would let a client re-point the framework that decides their own risk ratings.
 *
 * Duplicated from profile-service's own list ON PURPOSE — see the header. A test pins the two together
 * so the duplication cannot silently diverge.
 */
export const CODE_OWNED_FIELDS = ["frameworkPath", "workedExamplesPath", "allowedRecipes", "jxPolicy", "runCaps"];

/** Re-exported so the screens and their tests read the same list the validator does. */
export { KNOWN_PROFILE_KEYS, PROJECT_KEYS };

/** Strip the code-owned fields from an incoming profile body. Returns a NEW object; never mutates. */
export function stripCodeOwned(profile) {
  if (!profile || typeof profile !== "object" || Array.isArray(profile)) return profile;
  const out = { ...profile };
  for (const f of CODE_OWNED_FIELDS) delete out[f];
  return out;
}

/**
 * Serialise a profile for the editor: only keys the UI is allowed to see AND send back.
 *
 * An allowlist rather than a denylist. profile-service's read view carries derived values, framework
 * manifests and context packs; passing the whole thing through and trusting the browser to send back
 * only what it should is how an editor round-trips a field it was never meant to touch.
 */
export function serializeProfile(profile) {
  if (!profile || typeof profile !== "object") return {};
  const out = {};
  for (const k of KNOWN_PROFILE_KEYS) {
    if (CODE_OWNED_FIELDS.includes(k)) continue;
    if (profile[k] !== undefined) out[k] = profile[k];
  }
  return out;
}

/**
 * Code-owned fields whose VALUE is a path inside the engine. Withheld from clients; see readOnlyFields.
 *
 * portal-ui/src/contract/profileFields.ts holds the same list, because that package is a self-contained
 * bundle and cannot import from driver/. Neither copy can see the other, so each is pinned by a test
 * asserting that every CODE_OWNED field whose name ends in `Path` appears on it — the drift shows up as
 * a red test rather than as a sixth path field quietly shipping to clients.
 */
export const PATH_FIELDS = ["frameworkPath", "workedExamplesPath"];

/**
 * The code-owned values, READ-ONLY, for display. The page shows them badged; it cannot send them.
 *
 * Two of them are PATHS INSIDE THE ENGINE — `skills/prelim-search/risk-framework-zephyr.md` — and they
 * are withheld from a client here, on the server, where the role is already in hand. The React page has
 * filtered them out of its own render since the rebuild, but a filter in the browser is a display
 * convenience and not a wall: the value still crossed the wire and was one devtools tab away.
 *
 * `staff` defaults to FALSE so the gate fails closed. A future caller that forgets to pass a role gets
 * the client-safe object, which is a missing row in someone's UI rather than a disclosure.
 */
export function readOnlyFields(profile, { staff = false } = {}) {
  const out = {};
  for (const f of CODE_OWNED_FIELDS) {
    if (profile?.[f] === undefined) continue;
    if (!staff && PATH_FIELDS.includes(f)) continue;
    out[f] = profile[f];
  }
  return out;
}

/**
 * The framework, shaped for this reader.
 *
 * Owner decision (2026-07-20): a brand owner may see the framework that RATES them in full — the band
 * ladder, what each band MEANS in the deck's own words, the axes it reasons on, the entity it speaks in,
 * and the deck of record. That is doc 50's whole point made visible: their matters are rated under their
 * own framework, in its own words, and saying so to them is the honest version.
 *
 * What they still may not see is where the file LIVES, for the reason in readOnlyFields — and
 * `source_deck`, which the field name makes sound safe and the DATA is not. Every manifest on disk uses
 * it as an internal provenance note rather than a deck title, and each one is unshippable for its own
 * reason:
 *
 *   house    "…IP Risk Assessment Framework.pptx (Privileged & Confidential), transcribed 2026-07-05
 *             (doc 50); supersedes the client-transposed neutral default"
 *   aurora   "Synthetic demo transposition of a customer risk deck (structure faithful, content
 *             invented), doc 50 shape"
 *   triage   "Ported from the interactive knockout-searches skill's 5-tier rating system (SKILL.md
 *             rating table + calibration rules), doc 50 shape"
 *
 * — an internal filename and a confidentiality marking on the first, "content invented" on the demo
 * accounts that exist to be shown to a prospect, and an engine source path on the third. The band
 * MEANINGS are the opposite case and stay: they are the real rating criteria (exposure, PR consequence,
 * likelihood of a forced name change), which is precisely what a brand owner is entitled to read.
 *
 * `workedExamples` becomes a BOOLEAN rather than being dropped. Whether the account is rated against
 * precedent is a real fact about how they are rated; the filename is not. Dropping the key outright
 * would have taken the fact with it — the page infers "has worked examples" from the presence of that
 * string, so a bare filter would have silently deleted the row instead of anonymising it.
 */
export function frameworkView(framework, { staff = false } = {}) {
  if (framework == null || typeof framework !== "object" || Array.isArray(framework)) return null;
  const hasWorkedExamples = typeof framework.workedExamples === "string" && framework.workedExamples.trim() !== "";
  // ── source_deck LEAVES THE VIEW FOR EVERY ROLE ────────────────────────────
  //
  // The strip above this line used to be client-only, on the reasoning that staff may read provenance —
  // and the owner then met "…pptx (Privileged & Confidential), transcribed …(doc 50)" on his own
  // install's GENERIC page: "cannot say this - its an obvious link to client data." The page is one
  // surface whichever role reads it, and a provenance note has no reader there. Provenance is not
  // deleted — it stays in the manifest on disk, the repo/audit side, exactly where doc 50 keeps it;
  // it simply never rides the view. The planted-field arm holds this for BOTH branches, because a
  // one-branch strip is how this leak shipped the first time.
  const cleanManifest = (m) => (m != null && typeof m === "object" && !Array.isArray(m)
    ? (({ source_deck, ...rest }) => { void source_deck; return rest; })(m)
    : m ?? null);
  if (staff) return { ...framework, manifest: cleanManifest(framework.manifest), hasWorkedExamples };
  const { path, workedExamples, manifest, ...rest } = framework;
  void path; void workedExamples;
  return { ...rest, manifest: cleanManifest(manifest), hasWorkedExamples };
}

/**
 * Resolve which account this request is allowed to act on.
 *
 * The ONE place tenancy is decided for every upstream route. It throws PortalDeny(404) for a foreign
 * account — the same shape portal-service already turns into a 404 body — so a caller cannot forget to
 * check a return value and proceed with an unresolved account.
 */
export function resolveAccount(principal, requested) {
  // assertPrincipal is the existing chokepoint: it forces a client to their own grant and 404s a
  // foreign one. Reusing it means tenancy has ONE implementation, not two that must agree.
  const account = assertPrincipal(principal, { account: requested ?? null });
  if (!account) throw new PortalDeny(400, "name an account — staff must pick who they act for");
  return account;
}

/**
 * The upstream routes, mounted by portal-service under /portal/api/config/*.
 *
 * `callUpstream(method, path, body, identity)` is injected so this unit-tests offline. Live it is NOT
 * an HTTP call: profile-service re-verifies a Cloudflare Access JWT on every request and the portal
 * cannot mint one, so the portal constructs the profile service IN-PROCESS and calls its router
 * directly. Same code, same validators, one less hop and no second auth domain to get wrong.
 *
 * Identity travels as its own ARGUMENT, never in the body. profile-service stamps the git author and
 * the audit line from the identity it is given and ignores any author in the body — that is a hard rule
 * there, and this is the channel that respects it. What must never happen is the reverse: a body field
 * that looks like an author and is quietly trusted by some future reader.
 */
export function makeUpstream({ callUpstream, callRecipes = null, roster = async () => [] }) {
  const call = async (method, path, body, identity) => {
    const r = await callUpstream(method, path, body, identity);
    // Upstream 404s (unknown profile) and ours (not yours) are deliberately the same answer.
    if (r.status === 404) return { status: 404, json: { error: "not_found" } };
    return r;
  };
  // Saved searches ride a SECOND in-process service (recipe-service), injected separately because it
  // owns a different store and a different validator. Absent ⇒ every saved-search route answers 404,
  // which is what a deployment with no recipe store configured should say: the feature is not here.
  const callRec = async (method, path, body, identity) => {
    if (!callRecipes) return { status: 404, json: { error: "not_found" } };
    const r = await callRecipes(method, path, body, identity);
    if (r.status === 404) return { status: 404, json: { error: "not_found" } };
    return r;
  };

  return {
    /**
     * GET the profile a user may edit.
     *
     * Note what is NOT here: a roster listing for clients. `/profiles` (the full customer roster) is
     * never proxied — it is the list of every Cordillera client, and a client reaching it would learn
     * the customer base. Staff get the roster from the existing staff-only /portal/admin/roster.
     */
    async getProfile(principal, requested) {
      const account = resolveAccount(principal, requested);
      const r = await call("GET", `/profiles/${encodeURIComponent(account)}`, undefined, principal);
      if (r.status !== 200) return r;
      const p = r.json?.profile ?? r.json ?? {};
      const staff = principal?.role === "staff";
      return { status: 200, json: {
        account,
        profile: serializeProfile(p),
        readOnly: readOnlyFields(p, { staff }),
        contextPack: typeof r.json?.contextPack === "string" ? r.json.contextPack : "",
        // Display only, and shaped by role. The page renders the ladder, the band meanings and the entity
        // this framework speaks in; it can never SELECT a framework — that is a code change (doc 50).
        framework: frameworkView(r.json?.framework, { staff }),
        derived: r.json?.derived ?? null,
      } };
    },

    /**
     * Validate or save. `action` is constrained to two literals rather than interpolated from input —
     * a path segment reaching upstream unchecked is how /profiles/:key/../../something happens.
     */
    async writeProfile(principal, requested, action, body) {
      if (action !== "validate" && action !== "save") return { status: 404, json: { error: "not_found" } };
      const account = resolveAccount(principal, requested);
      const profile = stripCodeOwned(body?.profile);
      if (!profile || typeof profile !== "object" || Array.isArray(profile))
        return { status: 400, json: { error: "a profile object is required" } };
      return call("POST", `/profiles/${encodeURIComponent(account)}/${action}`, {
        profile,
        ...(typeof body?.contextPack === "string" ? { contextPack: body.contextPack } : {}),
      }, principal);
    },

    /**
     * A brand owner's projects — ARCHIVED ONES INCLUDED, for staff and clients alike.
     *
     * This used to filter archived projects out of a client's view entirely — hidden completely, with
     * recovery via Cordillera. That was coherent while Cordillera created every
     * project: the client could archive one, and the party who could bring it back was the same party
     * who had set it up.
     *
     * Clients now create their own (2026-07-22). Under the old filter, archiving one you had just made
     * removed it from your list AND removed the only control that could restore it — a one-way door on
     * your own record, which the screen had grown a paragraph to warn you about. Showing the row, greyed
     * and badged, is what makes archiving reversible; the paragraph went with it.
     *
     * Nothing about tenancy changes here. An archived project belongs to the same account it always did,
     * and every route still resolves that account from the verified principal.
     */
    async listProjects(principal, requested) {
      const account = resolveAccount(principal, requested);
      return call("GET", `/profiles/${encodeURIComponent(account)}/projects`, undefined, principal);
    },

    async getProject(principal, requested, project) {
      const account = resolveAccount(principal, requested);
      if (!isSlug(project)) return { status: 404, json: { error: "not_found" } };
      // Archived is no longer a reason to 404 an item a client owns — see listProjects. It never was a
      // tenancy rule; a foreign account still 404s here, from resolveAccount, which is where that rule
      // lives and the only place it should.
      return call("GET", `/profiles/${encodeURIComponent(account)}/projects/${encodeURIComponent(project)}`, undefined, principal);
    },

    async writeProject(principal, requested, project, action, body) {
      if (action !== "validate" && action !== "save") return { status: 404, json: { error: "not_found" } };
      const account = resolveAccount(principal, requested);
      if (!isSlug(project)) return { status: 404, json: { error: "not_found" } };
      // A project overlay may only carry PROJECT_KEYS. Customer-only keys are rejected upstream with a
      // real 400, but the same stripping discipline applies one level down: identity and rating
      // authority stay whole-customer.
      const overlay = stripCodeOwned(body?.profile);
      if (!overlay || typeof overlay !== "object" || Array.isArray(overlay))
        return { status: 400, json: { error: "a project overlay object is required" } };
      return call("POST", `/profiles/${encodeURIComponent(account)}/projects/${encodeURIComponent(project)}/${action}`, {
        profile: overlay,
        ...(typeof body?.contextPack === "string" ? { contextPack: body.contextPack } : {}),
      }, principal);
    },

    /**
     * Saved searches — the named, repeatable set-ups a brand owner runs clearances under.
     *
     * These are the WRITE doors the SavedSearches screen was built without, and the tenancy discipline
     * is the projects discipline exactly: the account is resolved by `resolveAccount` (never read off
     * the body), so a client authors only under their own customer key and a foreign one 404s rather
     * than 403s.
     *
     * WHAT A CLIENT MAY AUTHOR IS BOUNDED BY THE RECORD, NOT BY THIS LAYER. A saved search selects
     * MACHINERY — how wide and how deep to search. It can never touch rating authority: the framework,
     * the risk appetite and the delivery posture that decide how findings are RATED live in the customer
     * profile and stay staff-curated. That separation is structural, not conventional — the recipe key
     * set and the profile key set are provably disjoint, asserted by a unit test — so there is no
     * stripping to do here and no field list to keep in sync. recipe-service re-runs the driver's own
     * load-time validator on every write, which is why the UI cannot persist a search the engine would
     * later refuse.
     */
    async listSearches(principal, requested) {
      const account = resolveAccount(principal, requested);
      return callRec("GET", `/recipes/${encodeURIComponent(account)}`, undefined, principal);
    },

    async getSearch(principal, requested, slug) {
      const account = resolveAccount(principal, requested);
      if (!isSlug(slug)) return { status: 404, json: { error: "not_found" } };
      return callRec("GET", `/recipes/${encodeURIComponent(account)}/${encodeURIComponent(slug)}`, undefined, principal);
    },

    /**
     * Validate or save. `expectedVersion` is carried through because saved searches have optimistic
     * concurrency that profiles and projects do not: naming the version an edit was based on turns a
     * silent last-writer-wins clobber into a 409 the user can act on. Archive is a SAVE with
     * `archived: true` — there is deliberately no delete door, here or upstream, because a saved search
     * that produced a report is part of how that report came to say what it says.
     */
    async writeSearch(principal, requested, slug, action, body) {
      if (action !== "validate" && action !== "save") return { status: 404, json: { error: "not_found" } };
      const account = resolveAccount(principal, requested);
      if (!isSlug(slug)) return { status: 404, json: { error: "not_found" } };
      const recipe = body?.recipe;
      if (!recipe || typeof recipe !== "object" || Array.isArray(recipe))
        return { status: 400, json: { error: "a saved-search object is required" } };
      return callRec("POST", `/recipes/${encodeURIComponent(account)}/${encodeURIComponent(slug)}/${action}`, {
        recipe,
        ...(body?.expectedVersion != null ? { expectedVersion: body.expectedVersion } : {}),
      }, principal);
    },

    /** Staff-only: the customer roster, for the account picker. Clients never reach this. */
    async listRoster(principal) {
      if (principal?.role !== "staff") return { status: 404, json: { error: "not_found" } };
      return { status: 200, json: { customers: await roster() } };
    },
  };
}

/**
 * A project key must be a plain slug.
 *
 * This is the path-traversal guard. encodeURIComponent already neutralises `/` and `..` for a
 * well-formed fetch, but the value is also used to build an upstream path, and defence here is one
 * line while the failure is reading another customer's overlay file.
 */
const isSlug = (s) => typeof s === "string" && /^[a-z0-9][a-z0-9-]{0,63}$/i.test(s);
