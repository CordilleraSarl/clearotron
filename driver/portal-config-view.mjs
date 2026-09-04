// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// portal-config-view.mjs — the STAFF view of what this deployment is actually running.
//
// Two questions this answers, both of which currently require someone to ssh into the box:
//
//   "Is that feature on?"     — the flag snapshot, with what each flag's absence actually DOES.
//   "Why can't they log in?"  — the enrolment view, and specifically the half-done cases.
//
// ── THE FLAG PART ───────────────────────────────────────────────────────────────────────────────────
//
// This reads the snapshot, NOT process.env. portal-service's unit deliberately carries no environment
// file, so every switch reads as unset here and a page built on process.env would confidently report
// "everything is off" on a box where everything is on. That is the whole reason flag-snapshot.mjs
// exists; a config page that got it wrong would be worse than no page, because it would be believed.
//
// Each flag is labelled with HOW ITS ABSENCE IS FELT, from the snapshot's own `effect` field rather
// than from a second list here:
//
//   clarify              — off means the request is refused and the user is told.
//   silent-output-change — off means the OUTPUT is different and nobody is told. These are the
//                          dangerous ones. A screen that called them "clarify" would be telling a
//                          reassuring lie about the four flags most able to change a report unnoticed.
//
// ── THE ENROLMENT PART ──────────────────────────────────────────────────────────────────────────────
//
// Enrolment is TWO-SIDED: an email must be in the Cloudflare Access app (the edge) AND in the grants
// file (this side). Either half alone produces a confusing failure — admitted at the door and granted
// nothing, or granted something they can never reach. This side can only see its own half, and it says
// so rather than implying it has the whole picture.

import { statSync, openSync, readSync, closeSync } from "node:fs";

import { readFlagSnapshot, isStale, engineFor, providersFor } from "./flag-snapshot.mjs";
import { engineMode } from "./config-inventory.mjs";   // — the mode is DERIVED at read time, never stored

/**
 * The flag view.
 *
 * A missing snapshot is reported as UNAVAILABLE rather than as "everything off". Those are different
 * facts and only one of them is true; a page that renders unknown as off invites someone to go turn on
 * things that are already running.
 */
export function flagView(poolRoot, { now = Date.now() } = {}) {
  const snap = readFlagSnapshot(poolRoot);
  if (!snap) {
    return {
      available: false,
      note: "No configuration snapshot has been written on this instance, so what the engine has switched on cannot be read from here. Searches are unaffected — the portal accepts requests and the engine applies its own settings.",
      flags: [],
      built: null,
      // — stated rather than omitted, so this branch satisfies the same shape as the one below
      // and a reader cannot tell "no snapshot" from "an older snapshot" by a missing key. Both are
      // null, both mean THIS CANNOT ANSWER, and neither means "nothing is configured".
      engine: null,
      providers: null,
      // — NULL, NEVER "demo". Inferring a mode from an absent snapshot is the same defect one
      // level down: "no file" and "no engine" are different facts, and rendering the first as the
      // second tells a first-time visitor their install is limited when what happened is that nobody
      // has written a snapshot yet. `bin/start.mjs` writes one at boot, so this branch is the
      // pre- install and the genuinely unanswerable one.
      engineMode: null,
      capturedAt: null,
      stale: true,
    };
  }
  const flags = Object.entries(snap.flags ?? {}).map(([name, f]) => ({
    name,
    on: f.on === true,
    // "Explicitly off" and "never configured" behave identically and read very differently to somebody
    // deciding whether something is broken or simply was never switched on.
    configured: f.set === true,
    effect: f.effect ?? "unknown",
    killSwitch: (snap.killSwitches ?? []).includes(name),
  }));
  return {
    available: true,
    note: null,
    flags,
    built: snap.built ?? null,
    // — what this instance searches with. `null` when the snapshot predates the writer that
    // records it, which is every snapshot on every box until its driver next drains: the page must say
    // it cannot tell, NOT that nothing is wired up. An unconfigured instance sends an ARRAY of rows,
    // each `configured: false` — see flag-snapshot.mjs's engineFor/providersFor for the full argument.
    engine: engineFor(snap),
    // — DERIVED AT READ TIME from a fact the snapshot already carries (`binaryPresent`), so no
    // new stored field exists to disagree with the credentials. The ceiling here is honest: this can
    // tell DEMO from ENGINE-UNPROVEN, and nothing short of a completed probe turn can say READY — the
    // portal has no engine environment and never spends a turn, so it must not imply one.
    engineMode: engineFor(snap) ? engineMode(engineFor(snap)) : null,
    providers: providersFor(snap),
    capturedAt: snap.capturedAt ?? null,
    // Staleness is REPORTED, never acted on. A stale snapshot's values are still the last known truth,
    // and refusing to use them would be the fail-closed behaviour this whole design avoids.
    stale: isStale(snap, { now }),
  };
}

/**
 * THE SERVICE'S OWN NORMALISATION, mirrored rather than re-invented.
 *
 * item 1 landed in `880cf43e`, and it does NOT alias `cf-access` — it NORMALISES it at the read:
 *
 *     const AUTH_MODE_SET = (process.env.PORTAL_AUTH_MODE || "").trim().toLowerCase();
 *     const AUTH_MODE = AUTH_MODE_SET === "cf-access" ? "auth-proxy" : AUTH_MODE_SET;
 *
 * Mirroring that here is what keeps this page and that door telling the same story. The set below is
 * the post-normalisation vocabulary, so it holds one value rather than a list of spellings.
 */
const normaliseMode = (m) => (m === "cf-access" ? "auth-proxy" : m);
const FRONTED_MODES = new Set(["auth-proxy"]);

/**
 * The auth row — the one row on this page that is NOT snapshot-derived, and deliberately so.
 *
 * WHY THIS BREAKS THE PAGE'S OWN RULE ON PURPOSE (, ruled 2026-08-21). Every other row here comes
 * from a snapshot because the portal cannot see the engine's environment. `PORTAL_AUTH_MODE` is the
 * opposite case: the PORTAL reads it (portal-service.mjs) and acts on it, so the portal is the
 * authoritative source for its own door. Routing it through flag-snapshot.mjs would publish another
 * process's guess about this one's configuration and let it go stale — which is the exact failure the
 * stale-snapshot notice on this page exists to warn about. Adding an auth field to the writer would
 * satisfy the wording of the issue's fourth criterion and be the wrong build.
 *
 * PURE, AND FED FROM THE ROUTE. It takes the values rather than reading `process.env` itself, so it is
 * testable without mutating the environment — and so the one process entitled to answer this is
 * visibly the one doing the reading.
 *
 * WHAT IT MUST NEVER CARRY: the audience (`CLEAROTRON_OIDC_AUDIENCE`), any secret, or the contents of the token
 * header. The mode and the issuer, and nothing else. The local mode's single address is not printed
 * either — it is neither of those two things, and this page is read over shoulders and in screen
 * shares.
 *
 * @param mode   raw `PORTAL_AUTH_MODE`; empty/absent means the service's own default
 * @param issuer raw `CF_ACCESS_TEAM` — the issuer, never the audience
 */
export function authView({ mode = "", oidcIssuer = "", team = "", jwksUrl = "", emailClaim = "", authHeader = "" } = {}) {
  const declared = String(mode ?? "").trim().toLowerCase();
  // UNSET IS NOT UNKNOWN. portal-service.mjs treats an unset mode as the fronted default, so reporting
  // "not configured" here would describe a running instance as unconfigured. `declared: null` records
  // that nobody typed it, which is a different fact from the mode itself and is shown as such.
  //
  // NORMALISED, because the SERVICE normalises. `cf-access` is not an alias row — 880cf43e resolves it
  // to `auth-proxy` at the read, so a box configured `cf-access` is RUNNING `auth-proxy`. Reporting the
  // typed spelling as the mode would name a mode the service is not in, which is this page disagreeing
  // with the door it describes. Both are shown: the effective mode, and what was typed.
  const effective = normaliseMode(declared || "cf-access");
  const shape = FRONTED_MODES.has(effective) ? "fronted" : effective === "local" ? "local" : "unrecognised";
  // THE PROVIDER-AGNOSTIC ISSUER FIRST. gave the portal the same four values the staff MCP face
  // already read, so a deployment fronted by Entra or Google now has an issuer of its own and is no
  // longer described by a Cloudflare team name it does not have. `CF_ACCESS_TEAM` stays as the fallback,
  // because a Cloudflare-fronted box configures nothing else and naming the vendor's variable THERE is
  // accurate rather than vendor-framing.
  const oidc = String(oidcIssuer ?? "").trim();
  const cf = String(team ?? "").trim();
  const resolved = oidc || cf;
  // AN ABSENCE IS A STATE, not a missing key — the same discipline the provider rows take. The service
  // refuses to start on a fronted mode with neither (`(!TEAM && !OIDC_ISSUER) || !AUD` is fatal), so
  // this should be unreachable from a running portal; it is reported rather than omitted, because a row
  // that quietly drops the issuer looks identical to one that never needed it. BOTH variables are named
  // because either satisfies the service — naming only one would send an Entra deployment to go and
  // configure Cloudflare.
  const missing = shape === "fronted" && !resolved ? ["PORTAL_OIDC_ISSUER", "CF_ACCESS_TEAM"] : [];
  // — WHICH OF THE PROXY'S FOUR VALUES ARE SET, BY NAME AND NEVER BY VALUE.
  //
  // The issuer above answers "can the service start". These four answer "is the door configured the way
  // the operator thinks", which is a different question and the one a stranger install gets wrong: the
  // documented install lands in `local` and stops, so a box that is MEANT to sit behind a proxy looks
  // identical to one that is not. Reported for the fronted shape only — on `local` there is no proxy for
  // them to describe and listing four empty rows would read as four faults.
  //
  // PRESENCE, NOT VALUES. An issuer URL is not a secret but a header name can disclose a deployment's
  // internals, and the audience is already refused above. One rule for all of them is easier to keep
  // than a per-variable judgement, and `doctor` prints this straight to a terminal.
  const proxyValues = shape === "fronted"
    ? [["PORTAL_OIDC_ISSUER", oidc], ["PORTAL_JWKS_URL", jwksUrl], ["PORTAL_EMAIL_CLAIM", emailClaim],
       ["PORTAL_AUTH_HEADER", authHeader]]
      .map(([name, v]) => ({ name, present: Boolean(String(v ?? "").trim()) }))
    : [];
  return {
    mode: effective,
    proxyValues,
    // What the operator typed, kept separately: on a `cf-access` box these two now DIFFER, and an
    // operator who cannot see their own spelling cannot tell whether the page is describing them.
    declared: declared || null,
    shape,
    // Null for local: there is no third party issuing anything, and an empty string would render as a
    // blank where a reader expects a name. The AUDIENCE is never carried, in any mode.
    issuer: shape === "fronted" ? (resolved || null) : null,
    missing,
  };
}

/**
 * The enrolment view: who is granted what, and where an enrolment is half done.
 *
 * `grants` is the parsed grants file. `staffDomains` are admitted by domain rather than by grant, so
 * they are reported separately — a staff member absent from the grants file is normal, not a fault,
 * and listing them as "unenrolled" would bury the real problems.
 */
export function accessView({ grants, staffDomains = [], knownAccounts = [], grantsFile = null }) {
  const tenants = grants?.tenants ?? {};
  const known = new Set(knownAccounts);
  const people = [];
  const unknownAccounts = new Set();

  for (const [tenant, t] of Object.entries(tenants)) {
    const accounts = Array.isArray(t?.accounts) ? t.accounts : [];
    for (const a of accounts) if (known.size && !known.has(a)) unknownAccounts.add(a);

    for (const [email, grant] of Object.entries(t?.users ?? {})) {
      // "*" means every account this TENANT holds — not every account on the system. Expanding it here
      // is what makes the page show what the person can actually reach, which is the question being
      // asked; showing a literal "*" would need the reader to know that rule.
      const resolved = grant === "*" ? accounts : Array.isArray(grant) ? grant : [];
      const dangling = resolved.filter((a) => !accounts.includes(a));
      people.push({
        email,
        tenant,
        accounts: resolved,
        // A grant naming an account its own tenant does not hold. Usually a typo, and it fails as a
        // silent 404 for that person with nothing in any log to explain it.
        dangling,
        wildcard: grant === "*",
      });
    }
  }

  return {
    people: people.sort((a, b) => a.email.localeCompare(b.email)),
    staffDomains: [...staffDomains],
    // Accounts named in grants that no profile matches — the other typo direction.
    unknownAccounts: [...unknownAccounts].sort(),
    // Where to go to change any of this — a filename and a date, so "I want to add someone" has a
    // visible next step instead of ending at a page that only reports. Null when it cannot be stat'd.
    grantsFile,
    // Stated plainly, because this view genuinely cannot see the other half.
    //
    // — IT NO LONGER NAMES ONE VENDOR, and it no longer asserts an edge that may not exist. This
    // sentence told every reader that signing in needs Cloudflare Access, including a reader whose
    // instance runs the local passphrase door, where it is simply untrue. That is the sentence this
    // issue was raised over. The product owns authorization and does not own authentication: which door
    // proves identity is `PORTAL_AUTH_MODE`, and this view cannot see it.
    note: "Signing in needs both halves: the address must be authenticated by whichever door this instance runs (see docs/SECURITY.md), and granted an account here. This page can only see the second half.",
  };
}

/**
 * The observed view — who has actually USED this instance lately.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────────────────────────────
 *
 * accessView above answers "who is granted what", and for CLIENTS that is the whole answer. For STAFF
 * it answers nothing at all: staff are admitted by an email-domain rule, so there is no per-person
 * record anywhere in this product and the enrolled list is structurally incapable of naming one. The
 * question that kept being asked of that screen — "why can't I see my own colleagues on it?" — has no
 * fix inside the grants file, because the grants file is not where staff come from.
 *
 * So this reads the other direction: not who MAY act, but who HAS. The audit log already records the
 * signed-in email on every plan, trigger and settings save, and nothing has ever read it back.
 *
 * ── WHAT IT IS NOT ──────────────────────────────────────────────────────────────────────────────────
 *
 * An ACTIVITY log, not an access-control record. Absence from it means "has done nothing inside the
 * window read", NEVER "has no access". The screen has to say that, or a quiet list becomes evidence of
 * something it cannot evidence.
 *
 * ── WHAT IT DELIBERATELY DOES NOT SURFACE ───────────────────────────────────────────────────────────
 *
 * The records carry more than this returns, and the projection to {by, event, account, at} is the
 * point rather than laziness:
 *
 *   error     — the trigger path records upstream refusal detail in the audit BECAUSE it must not go
 *               in a response. Re-exporting it here would quietly undo that decision one surface over.
 *   selector  — carries a saved-search name, which is client business vocabulary.
 *   id/project— internal handles that answer no question this screen asks.
 *   ok        — a per-person failure tally reads as a performance record on a named colleague.
 *
 * Worth stating so nobody goes looking: MARK NAMES ARE NEVER IN THIS LOG. The plan site records a
 * count, not the marks, so "a trademark someone is considering leaked into an ops screen" is closed
 * upstream and not by this projection.
 *
 * ── DEGRADATION IS THE CONTRACT ─────────────────────────────────────────────────────────────────────
 *
 * Never throws, and the route never returns an error status. This is an EXTRA on a page whose real job
 * is explaining access; a missing, unreadable, enormous or half-corrupt log must cost the reader this
 * panel and nothing else. Two independent bounds — bytes read from the tail, and identities emitted —
 * because a log is unbounded by nature and this runs inside a web request.
 */
/**
 * 's outcome rows — the events that record a request being TURNED AWAY rather than done. Kept
 * beside the reader rather than in portal-service.mjs so this file has no import cycle with the
 * service that writes them; the names are the contract between the two and are asserted in the test.
 */
const OUTCOME_EVENTS = new Set(["request-refused", "request-error"]);

export function observedView({ auditPath, maxBytes = 256 * 1024, maxIdentities = 200 } = {}) {
  const unavailable = (note) => ({ available: false, truncated: false, people: [], note });
  if (!auditPath) return unavailable("No activity log is configured on this instance, so recent activity cannot be shown. Access itself is unaffected.");

  let size = 0;
  try {
    const st = statSync(auditPath);
    if (!st.isFile()) return unavailable("No activity log is readable on this instance, so recent activity cannot be shown. Access itself is unaffected.");
    size = st.size;
  } catch {
    return unavailable("No activity log is readable on this instance, so recent activity cannot be shown. Access itself is unaffected.");
  }
  if (size === 0) return { available: true, truncated: false, people: [], note: null };

  // Read the TAIL: the newest records are the ones worth showing, and a log that has grown for a year
  // must not be pulled into memory to display a dozen names.
  let text = "";
  let truncated = false;
  let fd = null;
  try {
    fd = openSync(auditPath, "r");
    const start = Math.max(0, size - maxBytes);
    truncated = start > 0;
    const buf = Buffer.alloc(Math.min(size, maxBytes));
    readSync(fd, buf, 0, buf.length, start);
    text = buf.toString("utf8");
  } catch {
    return unavailable("The activity log could not be read, so recent activity cannot be shown. Access itself is unaffected.");
  } finally {
    if (fd !== null) { try { closeSync(fd); } catch { /* nothing useful to do */ } }
  }

  const lines = text.split("\n");
  // A tail read almost certainly lands mid-record; that first fragment is not a record and is dropped
  // rather than half-parsed.
  if (truncated) lines.shift();

  const byEmail = new Map();
  // Newest first, so the identity cap keeps the MOST RECENT people rather than an arbitrary set.
  for (const line of lines.reverse()) {
    if (!line.trim()) continue;
    let rec;
    try { rec = JSON.parse(line); } catch { continue; }   // a corrupt line costs its own row, nothing more
    const email = typeof rec?.by === "string" ? rec.by.trim().toLowerCase() : "";
    if (!email) continue;
    let p = byEmail.get(email);
    if (!p) {
      if (byEmail.size >= maxIdentities) continue;        // stop admitting new names; keep counting known ones
      p = { email, events: {}, accounts: new Set(), firstSeen: null, lastSeen: null, count: 0, refused: 0 };
      byEmail.set(email, p);
    }
    p.count += 1;
    const event = typeof rec.event === "string" ? rec.event : "other";
    // — A REFUSAL IS NOT A USE, and this panel answers "who has actually USED this instance".
    //
    // Before the outcome rows existed every record here was something that HAPPENED, so `count` and
    // "activity" were the same number. They are not any more: a person who tried an admin write forty
    // times and was refused every time now files forty records, and without this split they read as
    // the busiest member of staff on the page. That is a worse answer than the one this panel gave
    // before the rows were added — the failure mode of adding a source to an aggregator that was
    // written when only one kind of thing was in it.
    //
    // `count` stays the total, so nothing that reads it changes meaning; `refused` is the part of it
    // that was turned away. Both, because "39 of 40 refused" and "1 of 40 refused" are different
    // stories and neither is tellable from one number.
    if (OUTCOME_EVENTS.has(event)) p.refused += 1;
    p.events[event] = (p.events[event] ?? 0) + 1;
    if (typeof rec.account === "string" && rec.account) p.accounts.add(rec.account);
    const at = typeof rec.at === "string" ? rec.at : null;
    if (at) {
      if (!p.lastSeen || at > p.lastSeen) p.lastSeen = at;
      if (!p.firstSeen || at < p.firstSeen) p.firstSeen = at;
    }
  }

  const people = [...byEmail.values()]
    .map((p) => ({ ...p, accounts: [...p.accounts].sort() }))
    .sort((a, b) => String(b.lastSeen ?? "").localeCompare(String(a.lastSeen ?? "")));

  return { available: true, truncated, people, note: null };
}
