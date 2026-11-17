// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// portal-routes/admin.mjs — the staff pages under /portal/admin: the roster, settings, run families, retired runs,
// access and people, and who has used this installation.
//
// One of the portal service's route groups, moved out of its dispatcher unchanged; makePortalService says how it asks them.
import { statSync } from "node:fs";
import { basename, join } from "node:path";
import { envFrom } from "../../shared/env-aliases.mjs";
import { personPoints, withoutPerson, withPerson } from "../../shared/grants-edit.mjs";
import { resolvePerson } from "../../shared/scope.mjs";
import { livePosture } from "../flag-snapshot.mjs";
import { assertPrincipal, mayRun, reachCovers, seesEverything } from "../portal-access.mjs";
import { accessView, authView, flagView, observedView } from "../portal-config-view.mjs";
import { familiesView, groupRuns, ungroupRuns } from "../portal-families.mjs";
import { forRole, resolveRunAccount, scanAccountRuns } from "../portal-runs.mjs";
import { updateArchived } from "../publish/archive-tags.mjs";
import { readJson } from "../run-record.mjs";

export async function adminRoutes({ poolRoot, workspaceRoot, grants, localSignIn, writeGrants, revokeConnectorKeys, queueDirs, audit, auditPath, loadProfilesImpl }, { method, parts, principal, grantsHere, body, query }) {
  // /portal/admin/* — the install-wide surfaces, for a person who sees everything, and People, for a
  // person with Manage. Everyone else gets 404: the surface does not exist for them.
  if (parts[1] === "admin") {
    assertPrincipal(principal, parts[2] === "access" || parts[2] === "people"
      ? { door: true, manage: true } : { door: true, everything: true });
    if (parts[2] === "roster" && method === "GET") {
      const profiles = await loadProfilesImpl();
      // `generic` IS in the roster — this route is staff-only (asserted above), and untagged runs
      // are real work that staff have to be able to select. Excluding it made those runs reachable
      // by typing ?account=generic but invisible in the switcher, which is how they stop being
      // looked at. The client-facing boundary is unchanged: /portal/api/runs and the report route
      // both 404 `generic` for a non-staff principal.
      // THE FACTS RIDE WITH THE NAME. The pick panel tells companies apart by industry, marketplace
      // count and territories, and it renders for staff from here and for a client from /me. Shaping
      // both through `companyFactsOf` is what stops the same company reading two ways depending on
      // who signed in. Dynamic import deliberately: `profiles.mjs` captures the store directory at
      // MODULE LOAD (see this file's note above), so it is never pulled in at our own load time.
      const { companyFactsOf } = await import("../profiles.mjs");
      // A company whose file would not load is named with its reason (staff-only route), never left out
      // in silence: a switcher with one company where there were twenty-five reads as deleted work.
      const unreadable = Array.isArray(profiles?.unreadable) ? profiles.unreadable.map((u) => ({ key: u.key, reason: u.reason })) : [];
      return { status: 200, json: { customers: [...profiles.values()].map((p) => ({ key: p.key, name: p.name, ...companyFactsOf(p) })), ...(unreadable.length ? { unreadable } : {}) } };
    }
    // /portal/admin/config — what this deployment actually has switched on. Read from the SNAPSHOT,
    // never from process.env: this process has no engine environment, so asking its own env would
    // report every switch as off on a box where they are on — and this page, of all pages, would be
    // believed.
    if (parts[2] === "config" && method === "GET") {
      // THE AUTH ROW IS READ LIVE, HERE, and not from the snapshot (ruled 2026-08-21).
      // Everything else on this page is RENDERED from the snapshot. The reason recorded here used
      // to be "because this process has no engine environment", and that has not been true since
      // the owner's 2026-08-26 one-configuration-per-server-box ruling gave every unit the same
      // `EnvironmentFile=%h/.env`. The rule stands on a better reason: the snapshot records what
      // the ENGINE last ran under, and that is the fact this page reports. The portal's OWN door is
      // the opposite case: this process reads PORTAL_AUTH_MODE and acts on it a few hundred lines
      // below, so it is the authoritative source. Fed from process.env at the seam rather than
      // inside authView, so the one process entitled to answer is visibly the one reading.
      //
      // AND THE ENVIRONMENT IS READ ONCE MORE, FOR ONE PURPOSE: to say whether
      // the capture still DESCRIBES this box, never to supply a value. A deployment being
      // configured runs nothing, so its capture cannot age into a warning while its contents drift
      // — the disagreement is the signal the age never was. Degraded rather than fatal: a page that
      // refused to render because it could not derive the live posture would be a worse answer than
      // one that reports the capture and says it could not check it.
      let live = null;
      try { live = await livePosture(); } catch { live = null; }
      return {
        status: 200,
        json: {
          ...flagView(poolRoot, { live }),
          auth: authView({
            mode: process.env.PORTAL_AUTH_MODE,
            oidcIssuer: process.env.PORTAL_OIDC_ISSUER,
            team: process.env.CF_ACCESS_TEAM,
          }),
        },
      };
    }
    // /portal/admin/families — the mark families a person has asserted.
    //
    // STAFF ONLY, and by construction rather than by filtering: it hangs off /portal/admin, which
    // asserted staffOnly above and 404s for everyone else. That is a decision, not an oversight. A
    // family name is staff shorthand for a brand line — "Aqua range" can name a launch a client has
    // not announced — and a grouping a client can see but not edit or explain raises more questions
    // than it answers. Revisit when clients have a reason to care; until then the client's list is
    // exactly the mark list, which is what the browser falls back to when this 404s.
    if (parts[2] === "families") {
      const acct = query.account ?? null;
      if (method === "GET") {
        return { status: 200, json: familiesView(poolRoot, acct && acct !== "*" ? acct : null) };
      }
      if (method === "POST") {
        const runIds = Array.isArray(body?.runIds) ? body.runIds.map(String) : [];
        if (!runIds.length) return { status: 400, json: { error: "no runs given" } };

        // THE ACCOUNT COMES FROM THE RUNS, NEVER FROM THE BODY.
        //
        // Same rule as jobFor() above and for the same reason: a body-supplied owner is a body-supplied
        // tenancy claim. Each run's account is read from its own meta.json, and a request naming runs
        // from two owners is refused rather than silently filed under one of them — a family's band is
        // rolled up across its marks, and bands are only comparable inside one framework.
        const owners = new Set();
        for (const runId of runIds) {
          if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,180}$/.test(runId) || runId.includes("..")) {
            return { status: 400, json: { error: "unknown run" } };
          }
          try {
            const meta = readJson(join(poolRoot, runId, "meta.json"));
            owners.add(meta.customerKey || "generic");
          } catch { return { status: 400, json: { error: "unknown run" } }; }
        }
        if (owners.size > 1) {
          return { status: 400, json: { error: "those runs belong to different brand owners — a family covers one" } };
        }
        const account = [...owners][0];

        const r = body?.action === "ungroup"
          ? ungroupRuns(poolRoot, { runIds })
          : groupRuns(poolRoot, { name: body?.name, runIds, account });
        if (r.error) return { status: 400, json: { error: r.error } };
        // `status` so the success row and the refusal row above answer the same question the same
        // way: reading down this log, every admin write now says how it ended.
        audit({ event: `family-${body?.action === "ungroup" ? "ungroup" : "group"}`, by: principal.email,
          account, family: r.familyId ?? null, runs: runIds.length, status: 200 });
        return { status: 200, json: r };
      }
      return { status: 404, json: { error: "not_found" } };
    }
    // ── /portal/admin/retired — RETIRE, AND THE WAY BACK ──────────────────────────────────
    //
    // Staff could hide a run from every screen and had no way to do it except a terminal on the pool
    // host. The sidecar, its reader and its semantics were all already here (scanAccountRuns, ~line
    // 168); the only missing piece was a writer that is not a CLI.
    //
    // RETIRE, NEVER DELETE, and the issue is explicit about why: the pool is the published copy of
    // real client matter, so an irreversible control does not belong on a staff screen. This route
    // writes ONE file — archive-tags.json — and touches neither the run directory, the artifacts,
    // nor the matter ledger. Removing the id brings the run back exactly as it was, which is what
    // makes putting the control on the screen safe in the first place.
    //
    // The REPORT ROUTE STAYS OPEN on a retired run, deliberately and as before: retiring changes
    // what the pool advertises, not who may read what, and the link is in mail we have already sent.
    //
    // STAFF ONLY BY CONSTRUCTION — it hangs off /portal/admin, which asserted staffOnly above. That
    // is load-bearing here rather than incidental: retiring hides a run from the brand owner too, so
    // it is a curation act by the firm, not a per-reader preference. The per-reader one is, and
    // it deliberately uses a different store.
    if (parts[2] === "retired") {
      const acct = query.account ?? null;
      const scoped = acct && acct !== "*" ? acct : null;
      if (method === "GET") {
        return { status: 200, json: { account: acct ?? "*",
          runs: forRole(scanAccountRuns({ poolRoot, workspaceRoot, account: scoped, includeRetired: true, queueDirs: queueDirs() }), principal) } };
      }
      if (method === "POST") {
        const runIds = Array.isArray(body?.runIds) ? body.runIds.map(String) : [];
        if (!runIds.length) return { status: 400, json: { error: "no runs given" } };
        const restore = body?.action === "restore";
        // THE ACCOUNT COMES FROM THE RUNS, NEVER FROM THE BODY — the families rule above, for the
        // same reason. Reading each run's own meta.json is also what proves the id names a real pool
        // run: an unchecked id would let a typo write a tag for a run that does not exist, and that
        // tag would sit in the sidecar for ever with nothing to explain it.
        //
        // A RESTORE MUST NOT REQUIRE A READABLE META. It is the way back, and the case where you
        // most want it is the run whose directory has gone strange. So the id is validated as a
        // shape, and the meta read is best-effort on that path.
        //
        // ── — RESOLVED THE WAY THE LIST RESOLVES IT ────────────────────
        //
        // This read `<pool>/<runId>/meta.json` directly, and a run that was STOPPED never publishes
        // into the pool. So every press on a stopped run answered `400 unknown run` — the owner's
        // report, twice in his own audit log — while the list that drew the button had read the
        // run from the workspace. The endpoint and the screen were asking different questions about
        // the same id.
        //
        // `resolveRunAccount` asks the LIST's question, pool first and the wider scan only when the
        // pool cannot answer. The tenancy rule below is untouched: the account still comes from the
        // run, never from the body.
        const owners = new Set();
        for (const runId of runIds) {
          if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,180}$/.test(runId) || runId.includes("..")) {
            return { status: 400, json: { error: "unknown run" } };
          }
          const found = resolveRunAccount({ poolRoot, workspaceRoot, queueDirs: queueDirs(), runId });
          if (found) owners.add(found.account);
          // A RESTORE MUST NOT REQUIRE A RESOLVABLE RUN — it is the way back, and the case you most
          // want it in is the run whose directory has gone strange. Unchanged from what shipped.
          else if (!restore) return { status: 400, json: { error: "unknown run" } };
        }
        const archived = updateArchived(poolRoot, (set) => {
          for (const id of runIds) { if (restore) set.delete(id); else set.add(id); }
          return set;
        });
        audit({ event: restore ? "run-restore" : "run-retire", by: principal.email,
          account: owners.size === 1 ? [...owners][0] : null, runs: runIds.length, status: 200 });
        return { status: 200, json: { retired: !restore, runs: runIds.length, archived: archived.size } };
      }
      return { status: 404, json: { error: "not_found" } };
    }
    // /portal/admin/access — who is granted what, and where an enrolment is half done.
    if (parts[2] === "access" && method === "GET") {
      const { loadProfiles } = await import("../profiles.mjs");
      const companies = Object.fromEntries([...loadProfiles({ force: true }).values()].map((p) => [p.key, p.name ?? p.key]));
      // Where to go to change this. The stat is done HERE rather than inside accessView because
      // that function is pure and its tests call it with no filesystem at all; giving it IO would
      // cost that for a filename and a date.
      //
      // BASENAME, never the full path. This route is staff-only, so it is not a leak to a client —
      // but a full path bakes a deployment's layout into a JSON body that ends up in browser
      // caches, screenshots and support tickets, and the filename is the whole useful part.
      let grantsFile = null;
      try {
        const p = envFrom(process.env, "CLEAROTRON_ACCESS_FILE");
        if (p) grantsFile = { name: basename(p), modifiedAt: new Date(statSync(p).mtimeMs).toISOString() };
      } catch { /* reported as unknown; a failed stat must not take down the page that explains access */ }
      // WHETHER AN ISSUED KEY CAN BE WITHDRAWN AT ALL. This used to be whether a revocation list was
      // named in this process's environment, because a door with none named checked no list. Every door
      // now reads the install's default list when none is named (isRevoked, shared/scope.mjs), and that
      // is where a revocation from here is written, so keys can be withdrawn whenever this process has
      // a revoker at all.
      const keysRevocable = Boolean(revokeConnectorKeys);
      return { status: 200, json: accessView({ grants: grantsHere, viewer: principal, companies, grantsFile, localSignIn, keysRevocable }) };
    }
    // /portal/admin/people — give someone access. Manage-gated above; everything else is decided here.
    //
    // THE ADDER'S OWN REACH BOUNDS WHAT THEY GIVE. A point outside it is a 404, exactly as asking to
    // see it would be. Switches belong to the person, not to a point, so they are set only when the
    // person's whole access sits inside the adder's; otherwise the points are added, the switches stay
    // as they were, and the answer says which happened. Nobody sets their own switches, and nobody
    // gives Run without holding it.
    if (parts[2] === "people" && parts.length === 3 && method === "POST") {
      // CODE AS ITS OWN FIELD. `error` carries a sentence on most routes here and a token on a few, so
      // a client cannot tell the two apart by looking at it — and the one that reached the page as page
      // copy was a token. A code the client reads as a FIELD is decidable; prose never is.
      if (localSignIn) return { status: 409, json: { error: "local_sign_in", code: "local_sign_in" } };
      if (!writeGrants) return { status: 503, json: { error: "cannot_write_grants" } };
      const email = String(body?.email ?? "").trim().toLowerCase();
      if (!email || email.indexOf("@") <= 0 || email.indexOf("@") !== email.lastIndexOf("@"))
        return { status: 400, json: { error: "Enter one email address." } };
      // ACCESS TO EVERYTHING IS NOT A POINT, and the handler used to treat it as one. The form draws
      // "Everything on this Clearotron" only to somebody who holds it, and sent it as
      // `{kind:"everything"}` alongside the organisation and company points; nothing here matched
      // that kind, so it fell to the 404 below and the page rendered the refusal it keeps for a
      // point outside the adder's reach — "You can only give access to what you have access to
      // yourself" — to the one person on the install for whom that is false. The control had never
      // worked. It lives under `people` as a switch, not in any organisation, so it is read as one.
      const points = [];
      let wantsEverything = false;
      for (const a of Array.isArray(body?.access) ? body.access : []) {
        const key = typeof a?.key === "string" ? a.key : "";
        if (a?.kind === "everything" && seesEverything(principal)) wantsEverything = true;
        else if (a?.kind === "organisation" && (principal.genericOrgs ?? []).includes(key)) points.push({ tenant: key });
        else if (a?.kind === "company" && principal.accountOrgs?.[key]) points.push({ tenant: principal.accountOrgs[key], account: key });
        else return { status: 404, json: { error: "not_found" } };
      }
      if (!points.length && !wantsEverything) return { status: 400, json: { error: "Choose at least one organisation or company this person may see." } };
      const want = { run: body?.permissions?.run === true, manage: body?.permissions?.manage === true, everything: wantsEverything };
      if (want.run && !mayRun(principal)) return { status: 400, json: { error: "You cannot give Run clearances without holding it yourself." } };
      const existing = resolvePerson(email, grantsHere);
      const setSwitches = email !== principal.email && (!existing || reachCovers(principal, existing));
      // THE SWITCHES ARE WHERE ACCESS TO EVERYTHING IS WRITTEN, so a grant of it that cannot write
      // them writes nothing at all — and `withPerson` would return unchanged grants and this route a
      // 201 naming a person who gained nothing. Said instead of returned.
      if (wantsEverything && !setSwitches)
        return { status: 400, json: { error: "Access to everything is part of what a person may do, and that cannot be set from here for this address. Nothing was saved." } };
      let next;
      try { next = withPerson(grantsHere, { email, points, switches: want, setSwitches }); }
      catch (e) { return { status: 400, json: { error: String(e?.message ?? e).slice(0, 300) } }; }
      try { await writeGrants(next); }
      catch (e) {
        audit({ event: "person-add", by: principal.email, person: email, ok: false, error: String(e?.message ?? e).slice(0, 200) });
        return { status: 500, json: { error: "The guest list could not be written, so nobody was added." } };
      }
      audit({ event: "person-add", by: principal.email, person: email, points: points.length, switchesApplied: setSwitches, ok: true, status: 201 });
      const { loadProfiles } = await import("../profiles.mjs");
      const companies = Object.fromEntries([...loadProfiles({ force: true }).values()].map((p) => [p.key, p.name ?? p.key]));
      const person = accessView({ grants: next, viewer: principal, companies }).people.find((p) => p.email === email) ?? null;
      return { status: 201, json: { person, switchesApplied: setSwitches } };
    }

    // /portal/admin/people/change — change what somebody may do and see.
    //
    // THE DIFF IS COMPUTED HERE, FROM THE FILE, and never taken from the request. The page sends the
    // state it wants; this reads what the file holds right now, narrows that to the part of the
    // person the caller can see, and works out what to add and what to take away between the two. A
    // page that had been open while somebody else was edited would otherwise write its own stale
    // copy back over them — and the half it would overwrite is the half outside its own view, which
    // nobody looking at either screen could see happen.
    //
    // NOBODY CHANGES THEMSELVES. The Add form already refuses to set the adder's own switches; this
    // refuses the whole act, because a manager who can take their own Manage away can lock the
    // install's last manager out of it with one press, and the way back is a text editor on the box.
    if (parts[2] === "people" && parts[3] === "change" && parts.length === 4 && method === "POST") {
      // CODE AS ITS OWN FIELD. `error` carries a sentence on most routes here and a token on a few, so
      // a client cannot tell the two apart by looking at it — and the one that reached the page as page
      // copy was a token. A code the client reads as a FIELD is decidable; prose never is.
      if (localSignIn) return { status: 409, json: { error: "local_sign_in", code: "local_sign_in" } };
      if (!writeGrants) return { status: 503, json: { error: "cannot_write_grants" } };
      const email = String(body?.email ?? "").trim().toLowerCase();
      if (email === principal.email) return { status: 400, json: { error: "You cannot change your own access. Somebody else who manages this install can." } };
      const existing = resolvePerson(email, grantsHere);
      const held = personPoints(grantsHere, email);
      if (!existing && !held.listed && !held.points.length) return { status: 404, json: { error: "not_found" } };

      // What the caller can see of this person, and what they asked for — both in the same shape, so
      // the difference between them is the change.
      const inReach = (pt) => pt.account == null
        ? (principal.genericOrgs ?? []).includes(pt.tenant)
        : principal.accountOrgs?.[pt.account] === pt.tenant;
      const mine = held.points.filter(inReach);
      const want = [];
      for (const a of Array.isArray(body?.access) ? body.access : []) {
        const key = typeof a?.key === "string" ? a.key : "";
        if (a?.kind === "organisation" && (principal.genericOrgs ?? []).includes(key)) want.push({ tenant: key, account: null });
        else if (a?.kind === "company" && principal.accountOrgs?.[key]) want.push({ tenant: principal.accountOrgs[key], account: key });
        else return { status: 404, json: { error: "not_found" } };
      }
      const id = (pt) => `${pt.tenant}/${pt.account ?? "*"}`;
      const wanted = new Set(want.map(id));
      const kept = new Set(mine.map(id));
      const drop = mine.filter((pt) => !wanted.has(id(pt)));
      const add = want.filter((pt) => !kept.has(id(pt)));
      // TAKING THE WHOLE OF SOMEBODY'S VISIBLE ACCESS AWAY IS REMOVAL, and it has its own route, its
      // own confirmation and its own revocation. Reaching it by unticking every row would do half of
      // that act under the word "save".
      if (!want.length) return { status: 400, json: { error: "Leave them at least one organisation or company, or remove them instead." } };

      const switches = { run: body?.permissions?.run === true, manage: body?.permissions?.manage === true,
        everything: held.switches.everything };
      if (switches.run && !held.switches.run && !mayRun(principal))
        return { status: 400, json: { error: "You cannot give Run clearances without holding it yourself." } };
      // Switches belong to the person and not to a point, so they are set only when the whole of this
      // person sits inside the caller's reach. Otherwise the points move and the switches stay, and
      // the answer says which happened — the same contract adding already has.
      const setSwitches = reachCovers(principal, existing);
      let next;
      try {
        next = drop.length ? withoutPerson(grantsHere, { email, points: drop }) : grantsHere;
        next = withPerson(next, { email, points: add, switches, setSwitches });
      } catch (e) { return { status: 400, json: { error: String(e?.message ?? e).slice(0, 300) } }; }
      try { await writeGrants(next); }
      catch (e) {
        audit({ event: "person-change", by: principal.email, person: email, ok: false, error: String(e?.message ?? e).slice(0, 200) });
        return { status: 500, json: { error: "The guest list could not be written, so nothing was changed." } };
      }
      audit({ event: "person-change", by: principal.email, person: email, added: add.length, removed: drop.length,
        switchesApplied: setSwitches, ok: true, status: 200 });
      const { loadProfiles } = await import("../profiles.mjs");
      const companies = Object.fromEntries([...loadProfiles({ force: true }).values()].map((p) => [p.key, p.name ?? p.key]));
      const person = accessView({ grants: next, viewer: principal, companies }).people.find((p) => p.email.toLowerCase() === email) ?? null;
      return { status: 200, json: { person, switchesApplied: setSwitches, added: add.length, removed: drop.length } };
    }

    // /portal/admin/people/remove — take their access away.
    //
    // HOW FAR IT REACHES IS THE SERVER'S ANSWER, NOT THE REQUEST'S. A caller who can see the whole of
    // this person removes them from the install; a caller who can see one organisation's worth of
    // them takes away that organisation and nothing else. The page draws a different button for each
    // — it reads the same `covered` the view computes — but the request carries no scope to get
    // wrong, so a stale page cannot ask for more than the person pressing it can see.
    if (parts[2] === "people" && parts[3] === "remove" && parts.length === 4 && method === "POST") {
      // CODE AS ITS OWN FIELD. `error` carries a sentence on most routes here and a token on a few, so
      // a client cannot tell the two apart by looking at it — and the one that reached the page as page
      // copy was a token. A code the client reads as a FIELD is decidable; prose never is.
      if (localSignIn) return { status: 409, json: { error: "local_sign_in", code: "local_sign_in" } };
      if (!writeGrants) return { status: 503, json: { error: "cannot_write_grants" } };
      const email = String(body?.email ?? "").trim().toLowerCase();
      if (email === principal.email) return { status: 400, json: { error: "You cannot remove your own access. Somebody else who manages this install can." } };
      const existing = resolvePerson(email, grantsHere);
      const held = personPoints(grantsHere, email);
      if (!existing && !held.listed && !held.points.length) return { status: 404, json: { error: "not_found" } };
      const whole = reachCovers(principal, existing);
      const inReach = (pt) => pt.account == null
        ? (principal.genericOrgs ?? []).includes(pt.tenant)
        : principal.accountOrgs?.[pt.account] === pt.tenant;
      const mine = held.points.filter(inReach);
      if (!whole && !mine.length) return { status: 404, json: { error: "not_found" } };

      let next;
      try { next = withoutPerson(grantsHere, whole ? { email, all: true } : { email, points: mine }); }
      catch (e) { return { status: 400, json: { error: String(e?.message ?? e).slice(0, 300) } }; }

      // THE KEYS, AND ONLY ON A WHOLE REMOVAL. A narrowing leaves the person on the install with
      // access somewhere else, and their connector key is how they reach that.
      let keys = { checked: false };
      if (whole) {
        if (!revokeConnectorKeys) keys = { checked: false, note: "this installation cannot revoke issued keys from here" };
        else {
          try {
            const { grants: written, ...said } = await revokeConnectorKeys({ email, grants: next });
            next = written ?? next;
            keys = { checked: true, ...said };
          }
          // A REVOCATION THAT FAILED MUST NOT LOOK LIKE ONE THAT HAPPENED, and it must not take the
          // removal with it either: the access record is the gate every surface reads, and leaving
          // it in place because a key file could not be appended would be the larger failure.
          catch (e) { keys = { checked: true, failed: true, note: String(e?.message ?? e).slice(0, 200) }; }
        }
      }

      try { await writeGrants(next); }
      catch (e) {
        audit({ event: "person-remove", by: principal.email, person: email, ok: false, error: String(e?.message ?? e).slice(0, 200) });
        return { status: 500, json: { error: "The guest list could not be written, so nothing was changed." } };
      }
      audit({ event: "person-remove", by: principal.email, person: email, scope: whole ? "install" : "organisations",
        organisations: whole ? null : [...new Set(mine.map((pt) => pt.tenant))].length,
        keysRevoked: keys.revoked ?? 0, keysUnrevokable: keys.lateArm ? (keys.jtis?.length ?? 0) : 0, ok: true, status: 200 });
      return { status: 200, json: { removed: whole ? "install" : "organisations",
        organisations: whole ? [] : [...new Set(mine.map((pt) => pt.tenant))], keys } };
    }
    // /portal/admin/observed — who has actually USED this instance lately, from the audit log.
    //
    // ALWAYS 200, even when the log is missing or unreadable, with an `available` boolean — the
    // same contract flagView already uses for a missing snapshot. An error status here would trip
    // the screen's load gate and blank a page whose real job is explaining access, in order to
    // report that an optional extra was unavailable.
    if (parts[2] === "observed" && method === "GET") {
      return { status: 200, json: observedView({ auditPath }) };
    }
    return { status: 404, json: { error: "not_found" } };
  }
  return undefined;
}
