#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// portal-service.mjs — the unified client+staff portal.
// ONE address, ONE login: CF Access proves WHO (edge), portal-access.mjs decides WHAT THEY SEE
// (inner roster/chokepoint — THE boundary, fail-closed). Loopback-only, the recipe-service skeleton.
//
// Surfaces (all under /portal):
//   GET  /portal[/...]               — the React app (portal-ui/dist), served by portal-static.mjs
//                                      ABOVE the rate limiter; client-side routing owns the sub-paths.
//   GET  /portal/health              — liveness (no auth)
//   GET  /portal/login               —, LOCAL MODE ONLY: the sign-in form, server-rendered here
//   POST /portal/login                 rather than in the SPA (CI greps the built bundle for internal
//   POST /portal/logout                variable names, and a login screen has to explain configuration).
//                                      Absent on a Cloudflare-fronted instance, where the edge is the door.
//   GET  /portal/api/me              — { role, email, accounts }
//   GET  /portal/api/searches[?account=] — registry levels + the account's saved searches
//   POST /portal/api/run/plan        — the CONFIRMATION GATE: validate + resolve + honest summary +
//                                      short-TTL HMAC confirmationToken. Nothing spends yet.
//   POST /portal/api/run             — verify the token ⇒ trigger via the injected `trigger` (live: the
//                                      MCP HTTP face with an ops token that is verb-scoped to start_run
//                                      AND, since 2026-07-20, account-capped — so a confused deputy is
//                                      bounded twice: by the principal check in this file, and by the
//                                      token itself. Neither is assumed; opsTokenPosture() below reads
//                                      the live token and states the real posture at every boot.
//   GET  /portal/api/runs[?account=] — account-filtered runs (live workspace + delivered pool).
//   GET  /portal/report/<runId>/     — the CLIENT report, ownership-checked; foreign runs 404 (never
//                                      403 — existence must not leak).
//   GET  /portal/admin/roster        — staff-only proof surface (clients get 404).
//
// HARD RULES: the account for every scoped route comes from assertPrincipal (never the raw query for
// clients); job identity fields (profileKey, forwarder, forwarderEmail) are SERVER-stamped from the
// verified principal — a body cannot supply them; report/email identity derives from the REGISTRY
// (stageLabel), never a client's recipe label; every trigger is audited (JSONL) with the human email.
import "../shared/env-local.mjs";   // — FIRST: applies the CLEAROTRON_* translation before any module-top
// capture evaluates. Reads no `.env` here — that load is gated on isCliEntry(argv[1]).
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { storeInRepo, storeOutsideRepoMessage, makeCommittableAudit, resolveStoreRepoRoot, makeStoreCommit } from "../shared/store-in-repo.mjs";   //,
import { customerStoreDir, customerStoreLine } from "../shared/customer-store.mjs";   // — one store for the surface and the runs
import { clientFailureNote } from "../shared/client-failure-note.mjs";   // — one sentence, three surfaces
import { bareInvocation, invocationPrefix } from "../shared/invocation.mjs";   // — and why this one surface is by NAME
import { stdioConnectOffer, stdioConnectFor, STDIO_SHAPES } from "../shared/stdio-connect.mjs";   // — ONE author for the connect route
import { connectOffers, offersForWire } from "../shared/connect-clients.mjs";                 // — ONE table, resolved server-side
// — the portal became an ISSUANCE PATH here, deliberately and by owner ruling.
// A comment further down this file said "the portal cannot mint from here … this process deliberately
// holds no engine/MCP secrets — issuance is one path on purpose". MEASURED 2026-08-31: that wall is not
// built. `bin/start.mjs` generates TRADEMARK_MCP_TOKEN_SECRET into `~/.env`, the portal unit loads
// `EnvironmentFile=%h/.env`, and `childEnv` passes the same value to the portal child — so this process
// has held the signing secret on both start paths for as long as both have existed. The comment has been
// corrected in place rather than left to be trusted.
import { mintToken, accountsForEmail, loadGrants } from "../shared/scope.mjs";
import { resolvePort } from "../shared/listen.mjs";   // — the port SOURCE, decided once
import { fileURLToPath } from "node:url";

// The daily allowance and the ledger read moved to usage-ledger.mjs (2026-07-27) — a pure leaf the MCP
// preview can import without pulling this HTTP service into a tool call. RE-EXPORTED rather than
// re-declared: one number, one count, and every existing importer of this module keeps working.
export { DEFAULT_CLIENT_DAILY_RUNS, accountUsage };

// One sentence, two places (the capability payload and the route that refuses). Never names the
// missing credential: this reaches a client screen, and our plumbing is not their business.
//
// "YET" WENT. It promised a toggle somebody had forgotten, and the owner read it
// that way while composing a live matter — the truth was a billing posture the feature could not run
// under, which no client can act on either. The operator's answer is the boot log, which now names the
// engine condition; this string stays the client's, and says only what a client can do about it.
// This install's own root, resolved from THIS MODULE rather than from cwd — the service is started by
// systemd from a working directory nobody chose, so a relative path here reads a file that may not exist.
// `HERE` further down is function-scoped and not reachable from the route table.
const INSTALL_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const READ_OFF_NOTE = "Reading a brief is not available on this instance — set the search up below.";
import { basename, dirname, join, resolve as pathResolve } from "node:path";
import { driverDir } from "../shared/driver-dir.mjs";   //
import { createHmac, timingSafeEqual } from "node:crypto";
import { makePrincipal, assertPrincipal, PortalDeny } from "./portal-access.mjs";
// — the THIRD identity source (after the CF Access edge and, until, the deleted bypass). It
// decides nothing about access: it turns a passphrase into an email string, which then goes through
// makePrincipal and assertPrincipal exactly as a Cloudflare-verified address does.
import { readLocalCredential, establishCredential, checkPassphrase, mintSession, verifySession,
  makeAttemptLimiter, credentialPathFor,
  localCredentialHandoff, firstRunCredentialLines } from "./portal-local-auth.mjs";   
import { appendFlag, feedbackDir, MAX_WHY, VERDICTS } from "./feedback-store.mjs";
import { loadRecipes, PRODUCT_POLICIES, policyFor, countJobMarks, kebabCollisions,
  gateResolvedPolicy, productAvailability, UNAVAILABLE_NOTE, coverageDisclosure, reportIdentityFor } from "./search-policy.mjs";
import { PLAN_MAX_NAME_LENGTH } from "./register-plan.mjs";   // — the budget the screen states
import { productRows, productRow, baseTurnaroundFor } from "./product-rows.mjs";
import { resolveForDoor, gateResolvedRequest } from "./door-gates.mjs";
import { resolveEffectiveScope } from "./effective-scope.mjs";
import { quoteForJob } from "./run-quote.mjs";
import { readFlagSnapshot, builtFor, registerCanCountFor, registerTerritoriesFor, caseLawReadyFor } from "./flag-snapshot.mjs";
import { isDemo, demoPostureLine } from "./demo-posture.mjs";   
import { triggerCapGap, triggerCapWarning } from "./trigger-cap.mjs";   // F51 — one answer, three surfaces
import { makeUpstream } from "./portal-upstream.mjs";
import { flagView, accessView, observedView, authView } from "./portal-config-view.mjs";
import { familiesView, groupRuns, ungroupRuns } from "./portal-families.mjs";
import { validateJob } from "./enqueue-schema.mjs";
import { orderedQueueFiles, reorderQueue } from "./queue-order.mjs";   // the SAME sort drainQueue admits by
import { drainingState } from "./worker-heartbeat.mjs";   // / — is anything draining this install
import { batchMarkName } from "./mark-name.mjs";
import { DEFAULT_CLIENT_DAILY_RUNS, accountUsage } from "./usage-ledger.mjs";
import { productIdentity } from "../shared/product-identity.mjs";   // AGPL §13 — one answer, three surfaces
import { engineCommit } from "./engine-build.mjs";                  // — the SAME stamp pool meta records
// — siblings, on their own line: 's guard pins the line above and its subject is the JOIN
// (this endpoint and pool meta stamp the same function), not the import list. Kept separate so that
// pin keeps reading the shape it was written against.
import { engineCommitDate, engineProvenance } from "./engine-build.mjs";
import { classifySkillsStore } from "./skills-store-provenance.mjs";
import { makeStaticHandler, reportCsp, docCsp } from "./portal-static.mjs";
import { readReport, reportsOf, resolveReportFile, batchSummaryOf } from "./portal-report.mjs";
import { readArchivedSet, updateArchived } from "./publish/archive-tags.mjs";
import { readAcks, setAck, withAcks, ACKNOWLEDGEABLE } from "./portal-acks.mjs";
import { MAX_BRIEF, makeReadBudget } from "./compose-read.mjs";
import { BRAND, PALETTE, FONT_LINK, FAVICON_LINK, bracketMark, DOOR_ROOT, DOOR_ROOT_DARK, DOOR_THEME_INIT } from "../shared/brand.mjs";
import { envFrom, pinEnv } from "../shared/env-aliases.mjs";   // — a refusal names the name in force
import { accessAudience, audienceLabel } from "../shared/access-audience.mjs";   // — F54; jose-free on purpose
import { resolveNumericSetting } from "./numeric-setting.mjs";   // — the same table the engine enforces, without the throw a rendering surface must not take
import { isEntrypoint } from "../shared/is-entrypoint.mjs";   // — one entry-point test, all spellings
import { deploymentBox } from "../shared/deployment-box.mjs";   // — the box names itself; one rule

// The offering the portal menus build from — product-rows.mjs's row, unchanged.
//
// This used to derive the row inline, and so did recipe-service and the ops-MCP, and the comment here
// said the three could not drift because all of them were "pure derivations of the registry". That held
// while every field was a copy. It stopped holding when a row had to carry a COMPUTED turnaround and a
// client-facing NAME, so the derivation is one function now and this is a call to it.
const registryProducts = productRows;

// The client-facing wording for an unavailable level MOVED to search-policy.mjs (2026-07-27) and is
// imported above, unchanged. It lived here while the browser was the only client-facing surface; the MCP
// preview is a second one, and a client's assistant must read the same sentence a client's browser does.
// The rule it encodes is unmoved: the engine hands over a CAUSE, never a sentence, so no CLEAROTRON_* name
// can reach either surface. (CI greps the built bundle for `CLEAROTRON_` as the backstop.)

// (`truthyFlag` lived here to test a kill switch's value. The switches were retired 2026-07-27 and no
// gate on this path reads an environment variable any more.)

// ── the confirmation token (the what_if_plan → what_if_run idiom): HMAC over the EXACT server-
// stamped job the user confirmed (classes/goods/marks/markName/selector — review 2026-07-18: a
// names-only binding let a mutated resubmit spend) + the confirming identity, short TTL, ONE-SHOT
// (jti consumed on fire — a replay within the TTL never spends twice). ─────────────────────────────
const canonical = (o) => JSON.stringify(o, Object.keys(o).sort());
// The trigger-identity hash: every field of the server-stamped job that shapes scope/cost/identity.
// Sorted-array JSON (never a delimiter join — a '|' in a mark name aliased two mark sets to one key).
export function jobHashOf(job) {
  const marks = (job.marks ?? (job.markName ? [{ name: job.markName }] : []))
    .map((m) => ({ name: String(m?.name ?? m).trim().toLowerCase(), classes: Array.isArray(m?.classes) ? [...m.classes].sort() : undefined, ref: m?.ref }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return createHmac("sha256", "job-id").update(canonical({
    marks: JSON.stringify(marks), markName: String(job.markName ?? "").toLowerCase(),
    classes: JSON.stringify([...(job.classes ?? [])].sort()), goods: String(job.goods ?? ""),
    product: job.product ?? null, recipeKey: job.recipeKey ?? null,
  })).digest("base64url");
}
export function mintConfirmation({ secret, account, email, jobHash, now = Date.now(), ttlMs = 10 * 60 * 1000 }) {
  const jti = createHmac("sha256", secret).update(`${account}|${jobHash}|${now}|${Math.random()}`).digest("base64url").slice(0, 24);
  const payload = { account, email, jobHash, jti, exp: now + ttlMs };
  const body = Buffer.from(canonical(payload)).toString("base64url");
  const sig = createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${sig}`;
}
export function verifyConfirmation({ secret, token, account, email, jobHash, now = Date.now(), usedJtis = null }) {
  const [body, sig] = String(token ?? "").split(".");
  if (!body || !sig) return "confirmation token malformed — re-run the plan step";
  const want = createHmac("sha256", secret).update(body).digest("base64url");
  const a = Buffer.from(sig), b = Buffer.from(want);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return "confirmation token invalid — re-run the plan step";
  let p; try { p = JSON.parse(Buffer.from(body, "base64url").toString("utf8")); } catch { return "confirmation token unreadable — re-run the plan step"; }
  if (!(typeof p.exp === "number" && p.exp >= now)) return "confirmation expired — review the plan again and re-confirm";
  if (p.account !== account || p.jobHash !== jobHash)
    return "the request changed after confirmation — review the plan again and re-confirm";
  if (p.email !== email) return "this confirmation belongs to a different sign-in — review the plan and confirm yourself";
  if (usedJtis) {
    if (usedJtis.has(p.jti)) return "this confirmation was already used — plan again for another run";
    usedJtis.set(p.jti, p.exp);   // consume (one-shot); the caller sweeps expired entries
  }
  return null;
}

// The band ladder a run was rated against, and the tone of the band it landed on.
//
// Tone, not label, is what the UI colours and sorts by, and the join has to happen HERE because the
// server is the only side that knows the framework. Ladders are framework-scoped: house-default has four
// stops and says "Moderate" where house-triage says "Medium". A client that mapped labels to colours
// itself would mis-colour every customer whose framework is not the one it was written against.
//
// A run with no framework (every run archived before doc-50) yields an empty ladder and a null tone. That
// is honest — it was not rated against a ladder — and the UI renders the label alone, uncoloured.
function ladderOf(meta) {
  const bands = Array.isArray(meta.framework?.bands)
    ? meta.framework.bands.filter((b) => b && typeof b.label === "string" && typeof b.tone === "string")
      .map((b) => ({ label: b.label, tone: b.tone }))
    : [];
  const toneFor = (label) => bands.find((b) => b.label === label)?.tone ?? null;
  return { bands, toneFor };
}

// ── run listing: delivered (pool metas) + live (workspace status + frozen profile sidecar) ─────────
//
// `account` null means EVERY account — the staff "All brand owners" view. Every row carries its own
// `account` either way, so the caller never has to infer ownership from the request it made.
/** The registry's display face for a stored product key, or null for one it does not know. It answers for
 *  a RETIRED key too — a delivered run keeps the name it was sold under, which is the whole reason those
 *  rows still exist (search-policy.mjs RETIRED_POLICIES). */
const stageLabelOf = (product) => (typeof product === "string" ? policyFor(product)?.stageLabel ?? null : null);

/** THE PRODUCT'S CLIENT-FACING NAME for a run row — the same resolver, and the same field, the
 *  delivered report's masthead prints. The browser used to hold its own switch from product key to label
 *  (`home.ts depthLabel`), which is a mapping table in a second place: it drifted once already, listing
 *  only the five retired slugs so every run this build creates rendered a blank chip.
 *
 *  `.identity`, never `.banner` or `stageLabel` — on a RETIRED row those carry "Depth 4", and a depth
 *  number must never reach a client's screen. Null for a level the registry has forgotten: the chip goes
 *  blank rather than naming a search the run may not have been. */
const productNameOf = (product) => (typeof product === "string" ? reportIdentityFor(product).identity ?? null : null);

// `account` accepts one key, or an ARRAY of keys for an identity that holds several — the multi-brand
// client asking for all of its own work at once. An array is exactly the union of what that caller can
// already fetch one key at a time, so it widens no boundary; it just spares the browser one request per
// brand owner against a 120/min limit. It is NOT a wildcard: an empty array matches nothing, which is
// the safe direction, and `null` (every account) stays reachable only from scanAllRuns.
export function scanAccountRuns({ poolRoot, workspaceRoot, account = null, includeRetired = false,
  // — THE QUEUES THE RUNNER ACTUALLY DRAINS, which is not the same set as the
  // directories under `workspaceRoot`. Defaults to [] so a caller that passes none keeps exactly the
  // behaviour it had; the service passes `config.queueDirs`, the same getter the allowance counter reads.
  queueDirs = [] }) {
  const out = [];
  const only = Array.isArray(account) ? new Set(account) : null;
  const mine = (owner) => (only ? only.has(owner) : account === null || owner === account);
  // RETIRED RUNS ARE NOT LISTED HERE — unless the caller is the staff retired view, and asks.
  //
  // `pool-admin archive` has always written this sidecar, and until now the ONLY reader was the old
  // static index — the surface the edge stopped serving at the portal cutover. So the command reported
  // success, the staff index it re-rendered was unreachable, and the run stayed in full view on the one
  // page anybody actually opens. A curation verb that silently does nothing to the live surface is worse
  // than not having one: it is a control that lies about having worked.
  //
  // Retired for EVERY reader, staff included: that has not changed, and `includeRetired` does not widen
  // it. What changed is where the CONTROL lives. This comment used to argue that a portal fold
  // would be "a second place to look, out of step with the CLI" — true while retiring was only a CLI
  // act, and wrong the moment staff could retire from the screen they are already on. A control whose
  // inverse lives in a terminal on another host is a one-way door. So the portal now carries both, and
  // `includeRetired` is what the staff-only "Show retired" route reads. The default is unchanged, every
  // client-facing caller takes it, and nothing a client can request reaches this flag.
  //
  // Read once per scan rather than per run: a scan is a directory walk over the whole pool and this is
  // one small file, so re-reading it per entry would be the only O(n) sidecar read in the function.
  //
  // THE REPORT ROUTE IS DELIBERATELY NOT GATED ON THIS. Retiring a run takes it off the list; it does
  // not revoke a link. Report URLs are in email we have already sent, and the Caddyfile's legacy-report
  // rewrite exists precisely so those keep resolving — 404ing them here would rot them from a curation
  // command, which is not what "archive" means to the person typing it. Ownership is still enforced at
  // that route, unchanged; retirement is about what the pool ADVERTISES, not about who may read what.
  const retired = readArchivedSet(poolRoot);
  try {
    for (const name of readdirSync(poolRoot)) {
      const metaPath = join(poolRoot, name, "meta.json");
      if (!existsSync(metaPath)) continue;
      try {
        const meta = JSON.parse(readFileSync(metaPath, "utf8"));
        const owner = meta.customerKey || "generic";
        if (!mine(owner)) continue;
        // Tagged by runId — the same key pool-admin writes, which is the pool DIRECTORY name. Checking
        // both guards the one case where they differ: a meta whose runId was rewritten by a republish.
        const isRetired = retired.has(meta.runId ?? name) || retired.has(name);
        if (isRetired && !includeRetired) continue;
        // The retired view is EXCLUSIVELY retired runs, not the whole pool with a flag: it is the fold
        // you open to find something you filed, and mixing the live list into it would make "Show
        // retired" a second copy of the page you are already looking at.
        if (!isRetired && includeRetired) continue;
        // ONE report, one audience rule: a run you have rights to is always listed and served (spec
        // 2026-07-30 §5). The client gate's "held" state is retired — the machine-QC record lives in
        // meta.clientGate for the workbook/staff-index surfaces and decides nothing here.
        // WHICH DOCUMENTS THIS RUN HAS, off its own meta. `existsSync("report.html")` was the
        // test, and a knockout batch no longer publishes that file — every batch would have listed as
        // having no report at all while carrying three. reportsOf() reads the published list and answers
        // `report.html` for a run that predates it, which is every archived run and every clearance.
        const docs = reportsOf(meta).filter((r) => existsSync(join(poolRoot, name, r.file)));
        const hasReport = docs.length > 0;
        const { bands, toneFor } = ladderOf(meta);
        const band = meta.overall ?? meta.verdict ?? null;
        out.push({ runId: meta.runId ?? name, account: owner,
          title: meta.title ?? meta.matter ?? name, kind: meta.kind ?? "clearance",
          // THE MARK, separate from the report's headline.
          //
          // `title` is model-authored front matter: a real run carries "AquaPlus — US Preliminary
          // Trademark Clearance" as its title while the typed mark is "AquaPlus". The UI needs the mark
          // to name a row and to group reads; it needs the headline for nothing. Written into meta at
          // publish, so runs delivered before that carry null and consumers fall back to title.
          markName: typeof meta.markName === "string" ? meta.markName : null,
          // WHICH PROJECT (engagement) THIS RAN UNDER.
          //
          // Stamped into meta at publish from the run's frozen profile sidecar. Absent on every run
          // delivered before that stamp, and deliberately not back-filled: the sidecar is the only
          // honest source and it does not travel with a pool dir. Null therefore means "we do not know",
          // never "no project" — so nothing downstream may render it as "no project".
          projectKey: typeof meta.projectKey === "string" ? meta.projectKey : null,
          projectName: typeof meta.projectName === "string" ? meta.projectName : null,
          // Which read this is, for the Stages cell.
          //
          // THE REGISTRY FIRST, the frozen stamp only as a last resort — the same rule reportIdentityFor
          // follows, and it has to be the same rule or the product has two names on one screen. This read
          // the stamp FIRST, so after the Depth 1-5 renumbering a run's report banner said "Depth 2" while
          // its own row in this list still said "Stage 0.5". One system: the label is a pure function of
          // the level, so deriving it from the level names every run the way the product is named today.
          //
          // `meta.stageLabel` survives as the fallback for a run whose LEVEL the registry no longer knows
          // (a retired row) — there is no current answer there and the stamp beats a blank. A run older
          // than the level registry carries neither and stays null: the cell goes blank rather than
          // inventing a depth that never ran.
          // `meta.searchLevel` is the STORED key on a delivered run's meta.json and keeps its name on
          // disk — an archived run's record is not this build's to rewrite. What the wire carries is
          // `product`, because that is the word every client-facing surface uses now.
          product: meta.searchLevel ?? null,
          stageLabel: stageLabelOf(meta.searchLevel) ?? meta.stageLabel ?? null,
          productName: productNameOf(meta.searchLevel),
          state: "delivered", date: meta.date ?? null,
          // WHEN IT FINISHED, to the second (/). `date` is DAY precision and always was — it is
          // parsed out of the run directory name. Two reads of one mark delivered on the same day
          // therefore TIE, Array.prototype.sort is stable, and which one the parent row spoke for was
          // decided by readdirSync order rather than by recency.
          //
          // `issuedAt` has been written full-ISO into meta.json at every publish for as long as there
          // has been a publisher; it simply never crossed the wire. Measured on the test instance
          // 2026-08-04, the two House-default reads differ by 2m08s in this field and in nothing else
          // the page renders — which is the whole.
          issuedAt: typeof meta.issuedAt === "string" ? meta.issuedAt : null,
          // `overall` stays for the existing consumers; `band` is the same value under the name the UI
          // uses, alongside the ladder it belongs to.
          overall: band, band, tone: toneFor(band), bands,
          // Knockout batches summarise per name — the list renders "N names, worst: <band>" from this.
          // Each mark's band is resolved against the SAME ladder, so a batch cannot mix vocabularies.
          marks: Array.isArray(meta.marks)
            ? meta.marks.filter((m) => m && typeof m.name === "string")
              .map((m) => ({ name: m.name, band: m.band ?? null, tone: toneFor(m.band ?? null) }))
            : [],
          // Present ⇒ the run has a report-data.json and can render natively. Absent ⇒ legacy: the Result
          // screen iframes the baked file. Legacy is identified by ABSENCE, so this must stay undefined
          // rather than defaulting to 0 or 1.
          // BOTH writers (publish/knockout.mjs and the clearance producer) stamp the STRING
          // 'report-data/1' — gating on `typeof === "number"` alone meant the native-render flag NEVER
          // armed, even for runs with a report-data.json on disk (2026-07-29, filed during PR-9). The
          // string form maps to its numeric version; a bare number is honoured; anything else is legacy.
          reportSchema: typeof meta.reportSchema === "number" ? meta.reportSchema
            : typeof meta.reportSchema === "string" && /^report-data\/(\d+)$/.test(meta.reportSchema)
              ? Number(meta.reportSchema.slice("report-data/".length)) : null,
          // `report` is the run-level link and it is NULL for a batch — there is no run-level document
          // to open. `reports` is the list, one entry per name, and it is what a batch's row renders.
          // A single-document run carries both, pointing at the same place, so nothing that reads
          // `report` today changes shape.
          //
          // BOTH ARE DOCUMENT URLS, and `path` STAYS one. The obvious repair for "the per-mark
          // links open outside the portal" is to point `path` at the portal route instead — and it is
          // wrong twice. `report` is consumed as an IFRAME SOURCE, not as a link, so making its sibling
          // mean something else leaves two fields of the same name-shape with different kinds, and the
          // client that framed one would frame the other and load the shell inside itself. The client
          // needs to build a route; what it lacks for that is the NAME of the document, not a second
          // spelling of its address. That is `slug`, below.
          //
          // `slug` is null on a single-document run: there is one document and no name to pick between,
          // which is the same thing `report` being non-null already says.
          report: docs.length === 1 ? `/portal/report/${encodeURIComponent(name)}/` : null,
          reports: docs.map((r) => ({
            mark: r.mark,
            slug: r.slug ?? null,
            path: r.slug
              ? `/portal/report/${encodeURIComponent(name)}/${encodeURIComponent(r.slug)}/`
              : `/portal/report/${encodeURIComponent(name)}/`,
          })),
          // — stamped only where it is true. A row that says nothing about retirement is a live
          // row, on every surface that has ever consumed this listing; a `retired: false` on all of
          // them would be a new field for every reader to ignore.
          ...(isRetired ? { retired: true } : {}) });
      } catch { /* unreadable meta — skip */ }
    }
  } catch { /* no pool yet */ }
  // live runs: status.json + the frozen profile sidecar (freezeProfile writes `profileKey`)
  const readRun = (dir) => {
    try {
      const s = JSON.parse(readFileSync(join(dir, "status.json"), "utf8"));
      const p = JSON.parse(readFileSync(driverDir(dir, "profile.json"), "utf8"));
      const owner = p.profileKey ?? p.key ?? "generic";
      if (!mine(owner)) return;
      if (s.state === "delivered") return;   // the pool row is the delivered face
      // ── — RETIREMENT REACHES A RUN THAT NEVER PUBLISHED ──────────────────
      //
      // The pool branch above has honoured the sidecar since; this branch never did, so a tag
      // written for a run that ended without publishing sat in the file doing nothing and the run
      // stayed on the list. That is worse than the refusal it replaces: a control that reports success
      // and changes nothing is the failure `scanAccountRuns`'s own retirement comment is about.
      //
      // The failed and abandoned runs are exactly the ones a reader most wants off the list, so this is
      // the population the control was wanted for, not an edge of it. Same key as the pool branch —
      // the runId — and the same two-way filter, so "Show retired" stays exclusively retired.
      const liveRetired = retired.has(s.runId) || retired.has(basename(dir));
      if (liveRetired && !includeRetired) return;
      if (!liveRetired && includeRetired) return;
      // A live run already HAS the typed mark — status.json is where it has always lived. The frozen
      // search-policy sidecar carries the stage. Both are read here so a run does not change identity
      // when it crosses from live to delivered: same mark, same stage, same thread.
      let sp = null;
      try { sp = JSON.parse(readFileSync(driverDir(dir, "search-policy.json"), "utf8")); } catch { /* legacy/early run */ }
      // A PAUSE IS NOT A RUN. The engine writes `postponed` (a rate-limit park, auto-resuming at
      // `resetsAt`) and `recovering` (an auto-retry backing off), and the portal contract knows neither
      // — its coercion treats anything unrecognised as `running`. So a run parked for five hours showed
      // "Running", with the step it had reached before it stopped, and the customer had no way to tell a
      // pause from work. The UI has had a `paused` state and a `.dot.paused` rule the whole time, and
      // nothing on the wire could ever reach them.
      //
      // Mapped here rather than in the browser: the run listing is the one place that already turns
      // engine vocabulary into the words a client reads, and a second translation in the UI is a second
      // thing to keep in step. `pausedKind` keeps the two apart, because they say different things to
      // the person waiting — one has a time, the other is the system retrying itself.
      // `parked-for-human` (A5): the engine's grace-exit park — the runner was stopped (deploy restart)
      // with the run in flight. Mapped HERE, like the other two, so the wire NEVER carries the raw
      // value: the portal contract would coerce an unknown state to "running", which is exactly the
      // zombie face this state exists to end. pausedKind "operator" tells the UI which words to use.
      const paused = s.state === "postponed" || s.state === "recovering" || s.state === "parked-for-human";
      out.push({ ...(liveRetired ? { retired: true } : {}),
        runId: s.runId, account: owner, title: s.markName ?? s.slug, kind: s.lane === "knockout" ? "knockout-batch" : "clearance",
        markName: typeof s.markName === "string" ? s.markName : null,
        // The project, straight off the frozen sidecar this branch already reads as `p`. A LIVE run needs
        // no publish stamp and no back-fill — the sidecar is right there, and freezeProfile has written
        // both fields since spec 62.
        projectKey: typeof p.projectKey === "string" ? p.projectKey : null,
        projectName: typeof p.projectName === "string" ? p.projectName : null,
        // Registry first here too — a live run's frozen policy sidecar names WHICH level is running; what
        // that level is CALLED comes from the registry, so an in-flight run and a delivered one agree.
        product: sp?.level ?? null, stageLabel: stageLabelOf(sp?.level) ?? sp?.stageLabel ?? null,
        productName: productNameOf(sp?.level),
        state: paused ? "paused" : (s.state ?? "running"),
        pausedKind: paused ? (s.state === "recovering" ? "recovering" : s.state === "parked-for-human" ? "operator" : "rate-limit") : null,
        // The ONE honest ETA this system possesses. The engine computes it from the provider's own
        // reset header and has always written it; it reached the ops surface and stopped one hop short
        // of the browser. Absent for a recovery park, which backs off on a schedule rather than to a
        // stated time — so the UI must not promise a clock it does not have.
        resetsAt: typeof s.resetsAt === "string" ? s.resetsAt : null,
        // Elapsed, so a card can say how long this has been going without inventing a finish time.
        startedAt: typeof s.startedAt === "string" ? s.startedAt : null,
        step: s.stepLabel ?? null, stepN: s.stepN ?? null, stepTotal: s.stepTotal ?? null,
        // — a requested stop is a state the screen shows. Stamped by stop_run,
        // preserved by writeRunStatus's spread-merge, replaced by the terminal when the honour check
        // fires. The UI derives "Stopping…" from this beside a non-terminal state.
        stopRequestedAt: typeof s.stopRequestedAt === "string" ? s.stopRequestedAt : null,
        // A failed run with no reason on screen is a run the user has to phone somebody about. Both
        // fields are already written by every failure path (pipeline-knockout.mjs, the driver's
        // writeRunStatus); the listing simply used to drop them.
        reason: s.reason ?? null, failedStage: s.failedStage ?? null,
        // — the engine's OPEN-SET payload, its own field so the portal can show the sentence and
        // hide this. Staff only: the client redaction below replaces `reason` and must drop this too,
        // or the redaction would be defeated by the field that carries the raw words.
        reasonDetail: s.reasonDetail ?? null,
        date: (s.updatedAt ?? "").slice(0, 10), overall: s.verdict ?? null,
        // A live run has not been issued, so its last progress write is the honest ordering key — the
        // same role issuedAt plays for a delivered one, never presented as a finish time.
        issuedAt: typeof s.updatedAt === "string" ? s.updatedAt : null,
        // A live run has not been rated yet, so it has no band and no ladder. The UI shows an em-dash.
        //
        // `marks` IS NOT THE BAND LADDER. One array answered two questions and the second answer was a
        // false one: the Result screen reads its LENGTH as a name count, so an empty array told the
        // customer a three-name knockout batch had "0 names" for the entire run — on a row whose own mark
        // string beside it said the batch had three. The names are known from the moment the batch is
        // planned; the BANDS are what a live run does not have, and they stay null here.
        band: null, tone: null, bands: [],
        marks: Array.isArray(s.marks)
          ? s.marks.filter((m) => m && typeof m.name === "string").map((m) => ({ name: m.name, band: null, tone: null }))
          : [],
        reportSchema: null, report: null });
    } catch { /* not a run dir */ }
  };
  // QUEUED BUT NOT YET PICKED UP — the gap between pressing Start and the driver writing a status.json.
  //
  // The queue directory used to be skipped outright, so for that window a started clearance appeared in
  // NOTHING: not the pool, not the live list. The screen that had just promised "it will appear in
  // Clearances" was, for those seconds, wrong — and to anyone who pressed Start and went straight to
  // the list, indistinguishable from a run that never started at all. That ambiguity is the whole
  // reason this exists; the window itself is short (prelim-driver.path fires on the file landing).
  //
  // A PENDING job is `<id>.json` with no suffix — the runner renames to `.done`/`.failed` when it is
  // through, and those are history the pool and live scans already own. Reading only the bare `.json`
  // is therefore what keeps a finished run from appearing twice.
  //
  // ── AND THE TERMINAL MARKERS STAY OUT. THIS IS A DEAD-LETTER STORE, NOT A WORK SURFACE. ────────────
  //
  // 2026-07-28: this scan was briefly widened to also read `<id>.failed` / `.duplicate` /
  // `.manifest.failed`, reasoning that a job refused at the runner's intake gate never gets a run dir,
  // never gets a status.json, and so appears in no surface at all — the row says "Queued · Waiting to
  // start" and then silently disappears. The reasoning was sound. The inference from the data was not.
  //
  // The evidence offered for it was "the live queue is holding thirty of these". What that actually
  // meant is that THIS DIRECTORY HAS NO RETENTION AND NOBODY EVER CLEANS IT. The thirty spanned six
  // weeks and were test artefacts, raw Outlook message ids from the email door, and `mcp-*` dev runs;
  // twenty-six had no `.reason` sidecar at all, so each rendered as a row saying, in effect, something
  // stopped and we cannot say what or why. Twelve carried no `profileKey` and fell through to `generic`.
  // Home and Clearances both read this scan, so both filled with six weeks of dead letters on a morning
  // when nothing was running.
  //
  // A job refused at intake deserves an answer. That answer belongs AT SUBMISSION — the door that
  // refused it knows why, immediately, and can say so to the person standing there. It does not belong
  // to a directory that never forgets. Narrowing this by age or by owner would only make the junk
  // smaller: the source would still be a store with no retention, one policy change away from returning.
  //
  // So: a PENDING job is `<id>.json` with no suffix. The runner renames to `.done`/`.failed` when it is
  // through, and those are history the pool and live scans already own. Reading only the bare `.json` is
  // what keeps a finished run from appearing twice — and what keeps this list about work in progress.
  //
  // ORDER. The rows come back in the order the runner will ADMIT them (queue-order.mjs — the same
  // function drainQueue sorts with, so the list and the engine can never disagree), and each carries
  // a dense 1-based `queuePos`.
  //
  // Dense over the rows THIS CALLER CAN SEE, not the raw index in the lane. A client whose two jobs
  // sit at lane positions 4 and 9 must not be told "4" and "9" — that publishes how much work other
  // tenants have queued, which is the same thing the 404-never-403 rule exists to prevent. Staff
  // reading across every account see the true lane depth anyway, because for them every row is visible.
  const queuedRows = [];   // { row, lane, laneIdx } — positions assigned once the whole scan is in
  // — READ ONCE per scan, not per row: every row of one response must agree about whether a worker
  // exists, and a boundary crossed mid-scan would otherwise put "waiting its turn" and "waiting for a
  // worker" in the same list. A queued job cannot answer this itself — it has no claim and no sidecar, so
  // claim liveness is silent on precisely the rows that need it.
  //
  // `null` means NOT KNOWN, and that is the default EVERYWHERE except a local install. A deployed instance
  // drains through the systemd path/timer units, which run `main({once:true})` and write no heartbeat — so
  // a service that read a missing heartbeat as "no worker" would put a false alarm on every queued row in
  // production. Only the launcher that actually supervises a worker claims to know, and it is the same
  // launcher that sets the lock dir, so the two can never be set without each other.
  const draining = drainingState();
  const readQueued = (dir) => {
    let files = []; try { files = readdirSync(dir); } catch { return; }
    const ordered = orderedQueueFiles(dir, files.filter((f) => f.endsWith(".json") && !f.startsWith(".")));
    for (const [laneIdx, f] of ordered.entries()) {
      try {
        const j = JSON.parse(readFileSync(join(dir, f), "utf8"));
        const owner = j.profileKey ?? "generic";
        if (!mine(owner)) continue;
        // ALL the names, spelled the way the run's own status.json and its delivered meta.json spell
        // them — this took `marks[0].name` and named ONE mark of N, so a client who had just ordered a
        // three-name knockout screen saw a single name on the row that tells them it went in.
        const mark = batchMarkName(j.marks, typeof j.markName === "string" && j.markName ? j.markName : undefined);
        queuedRows.push({ lane: dir, laneIdx, row: { runId: j.id ?? f.replace(/\.json$/, ""), account: owner, title: mark ?? (j.id ?? "Queued"),
          // THE JOB'S OWN PIPELINE, not the literal "clearance". The row already carried
          // `product: "knockout-search"` and still called itself a clearance, so it was the one row in
          // the listing that contradicted its own product field — and Result.tsx gates the names line on
          // this, so a queued batch showed no names at all. A product the registry cannot place stays a
          // clearance: that is what the listing has always shown for anything it could not identify.
          kind: policyFor(j.product)?.pipeline === "knockout" ? "knockout-batch" : "clearance",
          markName: mark,
          // The job carries the KEY (portal-service stamps it from the composer) but no name — the name
          // is resolved by the engine when the run starts, and this job has not started. Null name, real
          // key: a consumer that wants a label falls back to the key rather than being told the run has
          // no project when it has one.
          projectKey: typeof j.projectKey === "string" && j.projectKey ? j.projectKey : null,
          projectName: null,
          // The ORDER's product, and its name off the same resolver every other row uses. The name was
          // missing here alone, and the browser covered for it by joining `product` against the composer
          // menu; with that join deleted a queued row would have degraded to a bare date — the one
          // row a client looks at straight after pressing Start. `stageLabel` stays null: nothing is
          // frozen until the run starts, and the registry answers for every product this door accepts.
          product: j.product ?? null, stageLabel: null,
          productName: productNameOf(j.product),
          // — "Waiting to start" is true of both a job behind other work and a job nothing will
          // ever pick up, and those are not the same thing to whoever just pressed Start. The position
          // still says where it sits in the line; this says whether the line is moving at all.
          state: "queued", step: draining === false ? "Waiting for a worker" : "Waiting to start", stepN: null, stepTotal: null,
          reason: null, failedStage: null,
          // Part of the row contract now; a job that has not started has none of them.
          pausedKind: null, resetsAt: null, startedAt: null,
          // A job file has no updatedAt — it has not run. Its MTIME is when it was queued, which is a
          // real fact rather than a fabricated one, sorts a just-queued run to the top where the
          // person who pressed Start will look, and is deterministic under test.
          date: new Date(statSync(join(dir, f)).mtimeMs).toISOString().slice(0, 10), overall: null,
          // Queued: its mtime, at full precision, for the same reason the day-level `date` uses it.
          issuedAt: new Date(statSync(join(dir, f)).mtimeMs).toISOString(),
          // The names the job was submitted with — no bands, because nothing has been rated. Same rule as
          // the live row: this array answers "which names", and only the delivered row can answer "at
          // what band".
          band: null, tone: null, bands: [],
          marks: (Array.isArray(j.marks) ? j.marks : [])
            .filter((m) => m && typeof m.name === "string" && m.name.trim())
            .map((m) => ({ name: m.name, band: null, tone: null })),
          reportSchema: null, report: null,
          queuePos: null } });   // filled below, once every lane has been read
      } catch { /* not a job file */ }
    }
  };
  // EVERY QUEUE ONCE. A directory can be reached both ways — `config.queueDirs`
  // lists the workspace queues too — and reading one twice would list every job in it twice and give
  // each row two positions in the line.
  const scannedQueues = new Set();
  const scanQueue = (dir) => {
    const key = pathResolve(dir);
    if (scannedQueues.has(key)) return;
    scannedQueues.add(key);
    readQueued(dir);
  };
  // THE CANONICAL INTAKE FIRST, and it is why this parameter exists. `CLEAROTRON_QUEUE_DIR` is where the
  // enqueue CLI and ops-MCP `start_run` write — which is where the PORTAL's own submissions land, since
  // its `trigger` is an ops-MCP hop. The walk below finds only `workspace-*/studio/prelim-search/queue`,
  // and a documented headless install has no workspaces at all: measured on the test box, the only queue
  // under the whole tree is the configured one, and it holds portal-prefixed jobs. So this scan ran ZERO
  // times there, and a submitted search was invisible on the dashboard from submit until claim — a
  // minute and a half of a client believing their order was lost.
  for (const d of Array.isArray(queueDirs) ? queueDirs : []) {
    if (typeof d === "string" && d) scanQueue(d);
  }
  try {
    for (const ws of readdirSync(workspaceRoot).filter((n) => n.startsWith("workspace-"))) {
      const studio = join(workspaceRoot, ws, "studio", "prelim-search");
      let slugs = []; try { slugs = readdirSync(studio); } catch { continue; }
      for (const slug of slugs) {
        // Still walked, so a deployment whose queue is not in `queueDirs` keeps working. The union is
        // deliberate: this must add a place to look, never remove one.
        if (slug === "queue") { scanQueue(join(studio, slug)); continue; }
        if (slug === "archive" || slug.startsWith("_") || slug.startsWith(".")) continue;
        let runs = []; try { runs = readdirSync(join(studio, slug)); } catch { continue; }
        for (const r of runs) readRun(join(studio, slug, r));
      }
    }
  } catch { /* no workspace */ }
  // Assign the ordinals last, across every lane at once. Cross-lane order is genuinely undefined —
  // the lanes are per-agent and drain concurrently against one shared pair of slots — so lanes are
  // ordered by path purely to make the result STABLE. An ordinal that reshuffled between two polls
  // of an unchanged queue would read as the queue churning when nothing had moved.
  queuedRows.sort((a, b) => a.lane.localeCompare(b.lane) || a.laneIdx - b.laneIdx);
  queuedRows.forEach((q, i) => { q.row.queuePos = i + 1; out.push(q.row); });
  return out.sort((a, b) => String(b.date ?? "").localeCompare(String(a.date ?? "")));
}

// A failure `reason` is NOT client-safe, and the listing must not hand it to a browser.
//
// The engine writes `reason = String(e?.stack ?? e)` truncated to 200 characters
// (pipeline.mjs:5366, pipeline-knockout.mjs:311). That is a raw stack trace: absolute filesystem
// paths, internal module names, provider error text. Useful to staff, and none of a client's business
// — and redacting it in the UI would be theatre, because the field still travels over the wire and
// sits in devtools whatever React chooses to render.
//
// A client still learns that the run stopped and roughly where, because the plan is right that an
// invisible failure is worse than a visible one: they keep `state`, `failedStage` (product vocabulary
// like "register-probe", not a stack), and a stable sentence telling them what happens next. What they
// lose is the trace.
// — the owner's failed-run ruling. ONE author for this sentence now: it was
// written out here and again in mcp-server/lib/audit-view.mjs, and a reword that fixed two of three
// copies is how the retired claim survives in whichever surface nobody is looking at.
const CLIENT_FAILURE_NOTE = clientFailureNote();

// The run-slot cap, resolved from the SAME table pipeline.acquireRunSlot resolves it from, so the number
// the screen states and the number the engine enforces cannot drift apart. It used to re-read
// `process.env` behind a second copy of the literal 2 — two independent copies of one number is the
// shape that drifts, and reading the raw environment skipped the alias resolution every other read of
// this variable gets. `numeric-setting.mjs` is imported at module scope where
// `driver.config.mjs` cannot be: it pulls in nothing but the alias table this file already imports.
//
// It is one global cap over one lock directory, never per brand owner: two owners each running one
// search fill the whole deployment, and saying it per-owner would over-promise throughput.
//
// NULL WHEN THE VALUE IS UNUSABLE, AND THE SCREEN THEN SAYS NOTHING. The engine REFUSES a non-numeric
// cap; this surface must not, because a misconfiguration that took out the screen an operator reads to
// find it would be a worse failure than the one being fixed. `slotNote` already renders a null cap by
// drawing no line at all, so the page states the number it has or stays quiet — never a number nobody
// chose.
export const concurrentRunsCap = () => {
  const r = resolveNumericSetting("CLEAROTRON_MAX_CONCURRENT_RUNS");
  return r.ok ? Math.max(1, r.value) : null;
};

function forRole(runs, principal) {
  // Staff see failure reasons verbatim; clients get the plain note. That redaction is the ONLY
  // role-shaping left: the held-run suppression is retired (one report, spec 2026-07-30 §5 — a run you
  // have rights to is always listed; the machine-QC record lives on the audit workbook).
  if (principal?.role === "staff") return runs;
  return runs.map((r) => {
    let out = r;
    // — the redaction must take `reasonDetail` with it. `reason` is replaced by a fixed note for a
    // client session; a second field carrying the engine's raw words would walk straight past that.
    if (r.state === "failed") out = { ...out, reason: CLIENT_FAILURE_NOTE, reasonDetail: null, reasonRedacted: true };
    return out;
  });
}

/** Every account's runs, in one pass. Staff only — the route enforces that, not this function. */
export function scanAllRuns({ poolRoot, workspaceRoot, queueDirs = [] }) {
  return scanAccountRuns({ poolRoot, workspaceRoot, account: null, queueDirs });
}

/**
 * ── — WHICH RUN IS THIS, ASKED THE WAY THE LIST ASKS IT ────────────────────
 *
 * The Retire control refused every run the owner pressed it on, with `400 unknown run`, because the
 * route resolved the id by reading `<pool>/<runId>/meta.json` — and **a run that was stopped never
 * publishes into the pool**. The Clearances list that offered the button reads a wider set: the pool,
 * the workspaces and the queues. So the screen showed a control for a run the endpoint could not see,
 * and the failed and abandoned ones — the population a reader most wants off the list — were exactly
 * the ones it could never act on.
 *
 * THE POOL READ STAYS FIRST, and that is not an optimisation for its own sake: a delivered run is the
 * common case and one targeted `readFileSync` answers it. The scan is the FALLBACK, so the cost of a
 * directory walk is paid only on the ids the pool cannot answer — which is the case that used to be a
 * refusal, so nothing that worked before got slower.
 *
 * IT ANSWERS WITH THE ACCOUNT, never with a boolean. The account is what the caller needs: the retire
 * and family routes take the owner from the RUN and never from the request body, because a body-supplied
 * owner is a body-supplied tenancy claim. A resolver that returned "yes, it exists" would leave that
 * rule needing a second lookup.
 *
 * @returns `{ account, state }`, or `null` when no surface this deployment lists knows the id.
 */
export function resolveRunAccount({ poolRoot, workspaceRoot, queueDirs = [], runId }) {
  try {
    const meta = JSON.parse(readFileSync(join(poolRoot, runId, "meta.json"), "utf8"));
    return { account: meta.customerKey || "generic", state: "delivered" };
  } catch { /* not published — which is the whole case this function exists for */ }
  // BOTH DIRECTIONS of the retired filter, because the way BACK from retirement has to resolve a run
  // that is currently hidden. `includeRetired` is exclusive on either setting, so one call cannot see
  // both, and a restore that could not resolve its own id would be a one-way door.
  for (const includeRetired of [false, true]) {
    for (const row of scanAccountRuns({ poolRoot, workspaceRoot, account: null, includeRetired, queueDirs })) {
      if (row.runId === runId) return { account: row.account ?? "generic", state: row.state ?? null };
    }
  }
  return null;
}

// ── the routing core (injected IO — unit-tests offline) ────────────────────────────────────────────
/**
 * THE FIRST PATH SEGMENTS THE AUTHENTICATED SERVICE OWNS UNDER /portal.
 *
 * ONE DECLARATION, HERE, BESIDE THE ROUTER. It used to be a second list living in portal-static.mjs,
 * where the static handler decides what to decline — and the two could disagree silently. When they did,
 * the failure was not an error: the caller got the app shell where it expected JSON, **and the route's
 * authorization check never ran at all**. `admin` was missed exactly that way, and the SPA answered the
 * staff roster route with the app shell.
 *
 * So the static handler imports this rather than restating it. The router is the half that cannot lie
 * about what it serves, and a list generated from it cannot fall behind it.
 *
 * `health`, `login` and `logout` are here even though they are NOT registered in `route()` — all three
 * are answered in `makeHttpHandler` before identity is resolved, and each only for one method. Their
 * entries are therefore load-bearing for the OTHER methods: a HEAD probe of /portal/health, or a GET of
 * /portal/logout, falls past its branch into the static handler, where this is what declines it. A test
 * that derived this set from `route()` alone would flag all three as stale and be wrong; it unions the
 * pre-identity paths in from the handler's own source and says why.
 *
 * — `login`/`logout` are RESERVED, not conditional. They are server routes only when the local
 * identity provider is running (PORTAL_AUTH_MODE=local); on a Cloudflare-fronted instance nothing
 * answers them. Listing them unconditionally means /portal/login is one address with one meaning on
 * every deployment — it 404s where there is no local provider instead of quietly rendering the SPA
 * shell, which is the answer that would let a future SPA screen claim the name out from under the
 * server route.
 *
 * CLOSED IN BOTH DIRECTIONS, asserted in portal-static.test.mjs against the router's own source: a
 * route registered without an entry here fails, and an entry naming a route that no longer exists fails
 * too. That is the closed-by-default the issue asks for — over the REGISTERED ROUTE SET, not over
 * arbitrary paths. An unknown path still renders the SPA, which is what makes client deep links work.
 */
// `connect-help` joined 2026-08-31. A head missing from this list is SWALLOWED by
// the static handler: the caller gets the app shell and the route's authorization check never runs —
// which for a route serving a document is a silent 200 of the wrong thing. The bijection arm caught it,
// and that is exactly what it is for.
// `sign-out` joins them for the reason the comment above gives: a head the server answers but does not
// RESERVE falls into the static handler and returns the app shell with a 200, which for a route whose
// whole job is to end a session is the worst possible silent success ( — F47).
export const SERVER_ROUTE_HEADS = Object.freeze(["api", "report", "admin", "health", "login", "logout", "sign-out", "connect-help"]);

/**
 * THE PORTAL'S HALF OF THE DECLARED-FIELD PARTITION (enqueue-schema DECLARED_JOB_FIELDS).
 *
 * `jobFor` below is an allow-list, and an allow-list drops in silence whatever it does not name. This is
 * the same list said out loud, plus a REASON for every declared field it deliberately leaves behind, and
 * doors-agree.test.mjs asserts the two halves together are exactly the declared set. A field declared
 * tomorrow fails the suite until somebody decides which half it belongs in — which is the one moment the
 * decision is cheap, and the mechanism that `deliveryRoute` slipped past for want of.
 *
 * NOT A RUNTIME GATE. See the note on DECLARED_JOB_FIELDS: refusing every non-carried field at runtime
 * would answer with the wrong remedy at the doors whose wire vocabulary differs from the job's.
 *
 * `carries` means THE FIELD REACHES THE STORED JOB — copied from the body, or stamped by the door from
 * something it trusts more. `id`, `profileKey`, `forwarder`, `forwarderEmail` and `clientPrincipal` are
 * the stamped five, listed below in `stamped`: they come from the door or the verified principal and a
 * body value for them is ignored on purpose. That is the tenancy wall, and it is why a client cannot
 * file against another brand owner by editing a request. Every OTHER carried field is the requester's,
 * verbatim, for validateJob to rule on.
 *
 * — `carries` IS NOW MEASURED, and it was prose until it was.
 *
 * `msgId` and `conversationId` sat in this list while `jobFor` hardcoded both to null and the trigger
 * hop stripped them off again. The totality test beside it could not see that: it asks whether every
 * declared field is classified, which a declared-and-nulled field satisfies perfectly. So the sentence
 * above asserted a behaviour and the test next to it checked a different one — the same shape as 's
 * "an invitation nothing honours", one level up.
 *
 * `stamped` exists so the new guard can be DERIVED rather than hand-listed. It splits `carries` into the
 * fields whose value is the requester's — driven with a distinctive value, and required to arrive — and
 * the fields whose value is the door's, where the body's value must be IGNORED. A hand-kept list of what
 * to check is the defect the totality test was written to end; portal-carries.test.mjs reads these two
 * arrays and fails on a carried field it has no probe for.
 */
export const PORTAL_JOB_FIELDS = Object.freeze({
  carries: Object.freeze([
    "id", "profileKey", "forwarder", "forwarderEmail",
    "markName", "marks", "classes", "goods", "ref", "projectKey",
    "jurisdictions", "platforms", "geography",
    "product", "recipeKey", "nativeLanguage", "caseLaw", "searchLevel", "deliveryRoute",
    "upfrontInstructions", "commercialFlexibility", "priorUse", "campaignShape", "deadline",
    // stamped by the ROUTE rather than copied by jobFor, and on the stored job all the same:
    // `clientPrincipal` from the verified principal's role. It can only ever ADD a cap to the run that
    // carries it, so reading it off the body would let a caller decline its own allowance.
    "clientPrincipal",
  ]),
  // The subset of `carries` whose value is the DOOR's, not the requester's. A body value for one of
  // these is ignored on purpose, so the guard drives them with a lie and requires the lie to lose.
  stamped: Object.freeze(["id", "profileKey", "forwarder", "forwarderEmail", "clientPrincipal"]),
  notCarried: Object.freeze({
    // — A CLIENT MAY NEVER DECLARE A RUN A DEMO. The banner it produces says the report
    // is fiction, and a field the requester controls that can mark their own report fiction — or, arriving
    // absent, mark a demo account's report real — puts the truth of the deliverable in the request. Same
    // precedent as the fixtures flag one issue over: operator doors declare it, the client door does not.
    demoRun: "the client door never declares a run a demo — the banner asserts the report is fiction, and "
      + "that is the deployment's statement about the account, not the requester's about their own report",
    registerFixtures: "a run that reads canned register payloads instead of calling a register. A CLIENT may "
      + "never ask for that: the result would be fiction wearing a real report's clothes, which is the failure "
      + "the demo marker exists to prevent one level up. Refused by omission here, and only ever set by a job "
      + "file somebody wrote deliberately (tracker issue 2038).",
    promptParts: "the requester's declaration that the prose rides as SIDECAR files (<base>.brief.md, …), "
      + "which exists because the hand-emitting email-loop agent can only `write` files. The portal composer "
      + "sends structured fields and writes no sidecars, so a job it built is never in that shape — carrying "
      + "the flag would have it claim an intake it did not use, and the door's own check would then look for "
      + "files nobody wrote (#1085).",
    msgId: "the email door's message id. This door has no message: the composer IS the request, and there "
      + "is no thread to thread it into. It was declared carried and reached the job as a hardcoded null "
      + "that the trigger hop then stripped, which is a declaration measuring nothing (#497).",
    conversationId: "the email door's thread id, and the portal has no thread. Same story as `msgId`: "
      + "declared carried, written null, stripped again. A reply lands in the portal, not in a mailbox.",
    customer: "the APPLICANT, and the account already resolved it — see the jobFor header. Letting a body "
      + "re-state it would let a client widen or silence their own self-exclusion set, which is a "
      + "rating-authority change wearing a scope field's clothes.",
    forwarderDomain: "domain-based customer resolution is what the tenancy wall replaces here: the account "
      + "comes from the verified principal, never from a string the body chose.",
    provider: "which register vendor answers is a deployment fact, not a client's to pick.",
    name: "the pre-markName spelling of the search subject. The composer sends markName/marks[]; carrying a "
      + "second name field would give one door two answers to 'what is being cleared'.",
    use: "the pre-goods spelling of the same field. Same reason as `name`.",
    tmp: "the pre-ref spelling of the reference number. Same reason as `name`.",
    brief: "the intake CONFIRMATION brief — written by the email door's own gate, quoting what was agreed "
      + "back to the requester. The portal has no such gate: its composer IS the agreement.",
    rawRequest: "the verbatim forwarded email. There is no forwarded email on this door.",
    deliverableSpec: "template/format asks are staff-curated on the profile, not per-request from a client.",
    customerUnknown: "arms candidate-self classification, and only the intake AI can honestly say the "
      + "applicant was neither stated nor implied. On this door the account states it.",
    parentRunId: "escalation lineage. The composer has no '＋ Another read' control yet (contract/reads.ts), "
      + "so nothing on this screen can honestly name a parent run.",
    dupOverride: "force-running past matter dedup is a confirmed staff override, never a field a client body "
      + "can set for itself.",
    enqueuedAt: "stamped by the queue writer at the far end of `trigger`, from the clock, not the body.",
    enqueuedVia: "which door queued it. A door that let a body name another door would erase its own trail.",
    enqueuedBy: "the verified token sub, stamped server-side (red-team #4). A caller-supplied one is "
      + "attribution a caller wrote about themselves.",
  }),
});

/**
 * Stamped on an error whose outcome row has already been filed. `route()` journals a throw and then
 * rethrows it, and makeHttpHandler's outer catch journals what it catches — without this the one crash
 * would file two rows and the log would over-count the thing it exists to count. A Symbol rather than a
 * property name so it cannot collide with a field any error type already carries.
 */
const AUDITED = Symbol("portal.outcome-audited");
const alreadyFiled = (e) => !!(e && typeof e === "object" && e[AUDITED]);

/**
 * — what a door refusal is allowed to SAY. Code-owned, closed set, keyed on the status.
 *
 * The alternative is journalling the thrown message, and that message comes from `verify()` — a
 * third-party JWT check on the Cloudflare deployments — which is free to put a claim, a subject or a
 * token fragment in it. This log is republished through /portal/admin/observed, so an unfiltered
 * message would turn a refusal into a disclosure surface, which the issue rules out in terms.
 *
 * The status is the fact a security review actually asks for and it is already a closed set. An
 * unmapped one falls back to a constant rather than to the message.
 */
const DENIAL_REASON = Object.freeze({
  401: "not authenticated",
  403: "not authorised for this account",
  404: "no such surface for this principal",
  429: "rate limited",
});

/**
 * — THE ROW A REFUSAL FILES. One shape, one sink, whichever side of `route` decided the answer.
 *
 * The portal used to journal an admin write only when it SUCCEEDED, so every refusal — a client's 404
 * on a staff surface, a malformed runId's 400, an unauthenticated POST's 401 — left no trace anywhere.
 * "Nothing happened" and "someone was turned away" were the same empty log, which is the one pair a
 * journal exists to tell apart.
 *
 * WHAT GOES IN: the method, the path, the resolved address if there is one, the status, a short reason.
 *
 * WHAT NEVER GOES IN, and the reason this is a function rather than an object literal at five call
 * sites: the body, the query string, any header, the session cookie, the passphrase. This log is read
 * back by /portal/admin/observed and is a different disclosure surface from the request that produced
 * it — a row carrying a credential would be worse than the missing row this issue is about. The
 * PATHNAME is passed here, never `req.url`, because the latter carries the query string.
 *
 * `by` is OMITTED, not nulled, when identity did not resolve: observedView keys people on that field
 * and skips a row without one, so an unauthenticated caller stays a refusal with no person attached
 * rather than becoming a person named "null".
 */
/**
 * — IS THIS ONE OF THE ADMIN WRITE PATHS? The scope line of the whole change.
 *
 * The issue's Out of scope is binding and specific: *"Per-request access logging for the whole portal.
 * This is about the admin WRITE paths, which are few, staff-only and already have a sink."* So the
 * outcome log is not a request log, and this predicate is what keeps it from becoming one.
 *
 * THE THREE THE ISSUE NAMES — retire/restore, grouping, feedback:
 *   POST /portal/admin/retired     run-retire / run-restore
 *   POST /portal/admin/families    family-group / family-ungroup
 *   POST /portal/api/feedback      report-feedback
 *
 * WRITTEN AS "POST UNDER /portal/admin/", NOT AS THREE LITERAL PATHS. Every GET under that prefix is a
 * read (config, access, roster, observed) and every POST is a write, so the prefix rule admits exactly
 * the writes and admits the NEXT one automatically. Three literals would have to be edited by whoever
 * adds the fourth admin control, which is the same "a call site gets forgotten" failure this issue was
 * filed about, moved one file over.
 *
 * `/portal/api/feedback` is the one write outside the prefix and is therefore named. It is a client
 * surface rather than a staff one, and it is in scope because the issue listed it.
 *
 * IT STAYS NAMED THOUGH THE ENDPOINT IS RETIRED. What it files changed — a refusal row rather
 * than a success row — and that is the reason to keep it, not a reason to drop it: an attempt to reach a
 * switched-off capture endpoint is the one thing about this path still worth recording. Dropping the
 * entry would make those attempts the silent absence the whole predicate exists to prevent.
 *
 * Exported so the scope can be asserted rather than described — the test pins both directions, and the
 * direction that matters is the one that must NOT file (a client 404 on /portal/api/runs).
 */
/**
 * Is the per-finding flag capture switched on? ( — no, and the owner ruled it off on 2026-08-20.)
 *
 * A SOURCE CONSTANT, NEVER AN ENVIRONMENT VARIABLE. Nothing at runtime can change it: there is no
 * deployment of this code where the capture endpoint answers, and no box where an operator can turn it
 * back on without a commit. That distinction is the whole point — this launch has just retired four
 * environment switches under ADR-0002, and minting a dark one to disable a feature would be that defect
 * reborn one file over.
 *
 * It is the DEFAULT of `makePortalService`'s `feedbackCapture` seam rather than a direct read in the
 * handler, so the retained resolver can still be driven by a test. Nothing but a test passes it.
 *
 * The capture path it gates is intact: `feedback-store.mjs`, `feedback-issues.mjs`, `feedback-mint.mjs`,
 * `scripts/feedback-mint.mjs` and their suites are untouched and still green. Re-enabling is this
 * constant, the `feedback: true` argument at the serve call site, and reverting 's portal-ui half.
 */
const FEEDBACK_CAPTURE = false;

/**
 * The POSTs that COMPUTE an answer and change nothing — the only exceptions to the rule below.
 *
 * Both read a request and hand back a draft or a price; neither writes a file, mints a token, moves a
 * run or spends anything. They are also the two POSTs a composing reader hits repeatedly while typing,
 * so they are where a refusal row would actually accumulate.
 *
 * NAMED HERE, so adding one is a visible edit to a list with a rule written above it. Everything else
 * under the two prefixes is covered by construction, which is what keeps this from becoming the
 * hand-kept list of "the ones we remembered".
 */
const NON_MUTATING_POSTS = Object.freeze(["/portal/api/compose/read", "/portal/api/run/plan"]);

/**
 * Does a refusal on this route owe the audit log a line?
 *
 * ── WIDENS 's ANSWER, and the reason is on that issue ─────────────────
 *
 * scoped this to `/portal/admin/*` plus the one named client write, on the reasoning that the
 * other write routes "already file a richer row" of their own. Measured, that is true of their
 * OUTCOMES and false of their REFUSALS: `stop`, `queue-cancel` and `trigger` audit after the lane
 * answers, so every refusal BEFORE that — an unresolvable id, a wrong state, a missing account — files
 * nothing. `/portal/api/ack` files nothing at all, in either direction, and it is the route whose UI
 * message is the least informative: the owner pressed Acknowledge, was told "That could not be saved
 * just now", and the one surface that would have said why was silent for that route.
 *
 * So the rule is now the PREFIX, not a list: a POST under `/portal/api` or `/portal/admin` is a write
 * unless it is named above. A route added later is covered without anybody remembering to add it,
 * which is the half of 's shape that kept failing.
 *
 * STILL REFUSALS ONLY, and 's cost argument is why that half is unchanged: `/portal/admin/observed`
 * reads this log back through a fixed 256 KiB tail, so every row a success files is span that panel can
 * no longer see. The routes that file a rich success row keep filing it and nothing duplicates it.
 *
 * The credential-carrying POSTs — `/portal/login`, `/portal/logout` — are outside both prefixes and stay
 * outside this, as they were.
 */
/**
 * ── — WHAT A FULL COUNTRY SEARCH WILL NOT CONTAIN ON THIS BOX ───────────────
 *
 * Said at the point of choosing, which is the whole issue: the disclosure in the delivered report is the
 * product working correctly — no report claims "no adverse case law" off a sweep that never dispatched —
 * and the defect is that the disclosure was the FIRST mention, after two and a half hours and real
 * spend.
 *
 * NAMES NO VENDOR AND NO VARIABLE. This is a client-facing string on a client-facing screen, and the
 * enrolment is an operator's job on the box, not a client's. It says what the reader gets instead, which
 * is the one thing they can weigh before ordering.
 */
const CASE_LAW_DARK_NOTE = "This deployment has no case-law source set up, so the case-law and opposition "
  + "reading will not run. The search still runs and the report states the gap rather than reporting no "
  + "adverse case law — but it will not tell you what the courts have decided.";

export function isAdminWrite(method, path) {
  if (String(method ?? "").toUpperCase() !== "POST") return false;
  // The pathname only; a caller that passes a full URL would otherwise match on a query string.
  const p = String(path ?? "").split("?")[0];
  if (NON_MUTATING_POSTS.includes(p)) return false;
  return p === "/portal/api" || p.startsWith("/portal/api/")
    || p === "/portal/admin" || p.startsWith("/portal/admin/");
}

function outcomeRow({ event = "request-refused", method, path, email = null, status, reason = null }) {
  const row = {
    event,
    method: String(method ?? "").toUpperCase().slice(0, 10),
    path: String(path ?? "").slice(0, 200),
    status,
  };
  if (email) row.by = String(email).slice(0, 200);
  if (reason) row.reason = String(reason).slice(0, 200);
  return row;
}

export function makePortalService({
  poolRoot, workspaceRoot, recipesDir = undefined, secret,
  staffDomains = [], grants = null,
  // The queue directories the RUNNER drains — the same list it hands checkRunCaps. The allowance counter
  // and the quota pre-check read their ledger beside these, so they count what the wall counts (:
  // they used to reconstruct a workspace-relative path that resolved to nothing once the queue moved out
  // of the workspace, and reported 0 for every account forever).
  //
  // A FUNCTION, not an array: the set is a `config` getter that rescans the disk, and a portal that
  // resolved it once at construction would miss a workspace created after boot. Injected rather than
  // read here because this module must not import driver.config at module scope.
  //
  // The default returns NOTHING, and that is the honest default rather than a convenient one: a service
  // built without this wiring reports `complete: false` — "I could not count" — instead of a zero that
  // reads as "no runs today".
  queueDirs = () => [],
  trigger = async () => { throw new Error("no trigger wired (PORTAL_MCP_URL/PORTAL_OPS_TOKEN unset)"); },
  // Stopping is its own seam, not a parameter on `trigger`. `trigger` is THE SPEND PATH — the one
  // function guarded by the confirmation token, the quota and the audit trail — and widening it into a
  // general "call any verb" helper would make every one of those guards look optional at the call site.
  // Stop spends nothing and confirms nothing; it deserves a door of its own.
  stopRun = async () => { throw new Error("no stop lane wired (PORTAL_MCP_URL/PORTAL_OPS_TOKEN unset)"); },
  // ── — WHAT THE STOP CONTROL MAY HONESTLY OFFER ─────────────────────────────
  //
  // The boot log has said for days that this instance's ops token cannot stop_run, and every Stop
  // press failed as an upstream refusal a user cannot read. A control the deployment cannot serve must
  // not render as available: the bootstrap reads the LIVE token's posture and passes the verdict here;
  // /me carries it; the button disables itself with the reason. Default available — a fixture-built
  // service has a working seam-injected stop lane, and this seam is about the DEPLOYED token.
  stopControl = { available: true, reason: null },
  // ── — THIS PORTAL, RUN AS A DEMO ───────────────────────────────────────
  //
  // `clearotron demo` brings up THIS service rather than the dev cockpit, so its Start control is the
  // real one and would reach a door with no credentials behind it. In demo mode every product reports
  // unavailable with the reason at the control, and the order path refuses with the same sentence —
  // one fact, two surfaces, which is why it is a `cause` in search-policy.mjs and not a flag in the
  // screen. Injected rather than read from env HERE so a fixture can drive both directions; the
  // bootstrap below is the only place that reads the environment for it, and `bin/start.mjs` is the
  // only thing that sets it.
  demo = false,
  audit = () => {},
  // The audit log's PATH, for the one surface that reads it back rather than writing to it
  // (/portal/admin/observed). Separate from `audit` above because that is a sink and this is a source,
  // and injected rather than read from env here so a test can point it at a fixture. Null ⇒ the
  // observed panel reports itself unavailable, which is a supported state rather than a failure.
  auditPath = null,
  // Diagnostics only (the report-embed nav strip reports what it did). Never a request path.
  auditLog = () => {},
  // — IS THE PER-FINDING FLAG CAPTURE ON? It is not, and `FEEDBACK_CAPTURE` is why (see above).
  //
  // A SEAM SO THE RETAINED PATH STAYS TESTED, which is the whole difference between disabled and
  // rotting. The resolver below carries 's two-lane shape and 's disposition read; the owner
  // ruled disable rather than delete, and code nothing can execute is code nobody can prove still works.
  // The eleven route tests in portal-service.test.mjs pass `feedbackCapture: true` and keep exercising it.
  //
  // THE BOOTSTRAP DOES NOT PASS IT, and that is asserted rather than trusted
  // (report-feedback-is-switched-off.test.mjs). No environment variable reaches this and no config file
  // names it: turning capture back on is a commit, on any box, which is the bar the owner set.
  feedbackCapture = FEEDBACK_CAPTURE,
  loadRecipesImpl = (o) => loadRecipes({ ...(recipesDir ? { dir: recipesDir } : {}), force: true, ...o }),
  // `readFlags` lived here until 2026-07-27, feeding the three admission kill switches from the snapshot
  // because this process deliberately has no engine environment. The switches are retired, so there is
  // nothing left to feed: availability now depends only on the build map below, which every service can
  // read the same way.
  //
  // The build map. `built.registerProbe` depends on which register the deployment wired (a provider that
  // cannot count cannot run Depth 2) and this process has no engine environment to work that out from,
  // so it is read from the snapshot. Re-read per call rather than captured at construction: re-running
  // the snapshot writer should take effect without a portal restart, and a map captured once at boot
  // would go stale in exactly the situation someone is actively trying to fix. Missing snapshot ⇒ the
  // module's own BUILT, i.e. degrade to available.
  readBuilt = () => builtFor(readFlagSnapshot(poolRoot)),
  readCanCount = () => registerCanCountFor(readFlagSnapshot(poolRoot)),
  // — which composer territories the wired register reaches. Same injection as readCanCount and
  // read from the same snapshot, because the portal has no engine environment and cannot work it out.
  // THREE answers survive the read: null (unrestricted), an array, or undefined (the snapshot does not
  // say — fail open). registerTerritoriesFor is what keeps them apart.
  readTerritories = () => registerTerritoriesFor(readFlagSnapshot(poolRoot)),
  // — whether this deployment has a case-law source enrolled at all. Same
  // injection and same snapshot as the two above, and the same tri-state: null is "the snapshot does not
  // say", which must not render as a warning on a working box.
  readCaseLaw = () => caseLawReadyFor(readFlagSnapshot(poolRoot)),
  // The config surface (Profile, Projects). Injected so tests drive it offline; live it is a
  // profile-service constructed IN-PROCESS — see portal-upstream.mjs for why it is not an HTTP hop.
  // Null ⇒ the routes answer 404, which is the correct behaviour for an instance without it wired:
  // indistinguishable from a build where the surface does not exist.
  upstream = null,
  // Reading a pasted brief into a filled-in composer (driver/compose-read.mjs). NULL is the normal
  // state on a box that was never given a model credential, and it is a SUPPORTED state, not a fault:
  // /portal/api/searches then reports `read.available: false`, the composer keeps its Read-this button
  // disabled with the sentence it already ships, and every other part of the screen works as before.
  //
  // Fail-DARK here, unlike the flag snapshot's fail-available. The two are opposite for the same
  // reason: an unknown level might be runnable and the gate is the real wall, whereas a missing
  // credential is a known, local, certain fact — an enabled button over it would 500 on every press.
  composeRead = null,
  // Per-person hourly budget for the button above. Injected so a test can exhaust it in three presses.
  readBudget = makeReadBudget(),
  // The customer roster, as a map of key → profile. TWO routes need it and for the same reason — the
  // account picker and /portal/api/me's name map both turn a slug into what the client is called — so
  // it is one injected reader rather than two inline dynamic imports that could drift apart.
  //
  // Injected mainly so a test does not depend on CLEAROTRON_CUSTOMERS_DIR: unset, `loadProfiles` falls back
  // to the repo's own driver/profiles, so a test asserting a name would be asserting a fixture that
  // ships for other reasons and can be renamed by someone who never runs this file.
  loadProfilesImpl = async () => (await import("./profiles.mjs")).loadProfiles({ force: true }),
} = {}) {
  if (!secret) throw new Error("portal-service: a confirmation secret is required (PORTAL_SECRET)");
  // grants may be a VALUE (tests) or a FUNCTION re-read per request (live: enrolment lands without a
  // restart; an unreadable grants file is a hard 500, never a fallback — review 2026-07-18)
  const grantsNow = () => (typeof grants === "function" ? grants() : grants);
  // one-shot confirmation jtis (in-memory: ONE portal process per instance — documented POC bound)
  const usedJtis = new Map();
  const sweepJtis = (now = Date.now()) => { for (const [k, exp] of usedJtis) if (exp < now) usedJtis.delete(k); };

  const searchesFor = (account) => {
    const recipes = loadRecipesImpl({});
    const built = readBuilt();
    const canCount = readCanCount();
    const territories = readTerritories();
    const caseLawReady = readCaseLaw();
    return {
      // Every product is LISTED whatever its state. A product that vanishes when unavailable leaves a
      // client with no way to know it exists and no reason to ask for it; one shown greyed WITH THE
      // REASON AT THE CONTROL is an invitation. The gate is the wall, not this list.
      products: registryProducts().map((l) => {
        const cause = productAvailability(PRODUCT_POLICIES[l.key], {
          built, registerCanCount: canCount, registerTerritories: territories, geography: l.geography, demo,
        });
        // ── — COVERAGE RIDES BESIDE AVAILABILITY, NOT INSIDE IT ───────────
        //
        // The owner, on his own install with a partial register: "i cannot press the button for Global
        // prelim search. Why. it doesnt appear disabled, no message etc — but i cant select it." The
        // product is orderable now (owner ruling on that issue), and what the register does not reach
        // is a SENTENCE on a live row rather than the reason a dead one cannot be pressed.
        //
        // A SEPARATE FIELD, because the two say opposite things to the screen: `unavailableNote`
        // explains a control that cannot be used, `coverageNote` qualifies one that can. Folding this
        // into the first would make every caller of `productAvailability` — the portal, the MCP door,
        // the dev cockpit — read a disclosure as a refusal, which is the behaviour the ruling removes.
        const coverage = coverageDisclosure(l.geography, territories);
        // ── — THE PRODUCT DECLARES WHAT IT NEEDS, so the row can say so ─────
        //
        // The owner ordered the one product carrying `caseLaw: true` and first heard of the lane in the
        // finished report, two and a half hours and real spend later. This screen already reads the
        // declaration — it renders "Reasoned against the case law and oppositions of that country" from
        // the same field — so it had the product's requirement and lacked only the deployment's answer.
        //
        // KEYED ON THE DECLARATION, never on a product id: a product that starts needing case law gets
        // this warning the day it declares it, and one that stops needing it loses the warning the same
        // day. That is the class instruction on the issue — derive it from what the product declares,
        // not from the hand-kept list of the two capabilities somebody remembered.
        //
        // ONLY ON AN EXPLICIT `false`. A snapshot that does not say is not evidence of a dark lane, and
        // a warning on every deployment whose writer has not run since is worse than the silence it
        // replaces.
        return { ...l, available: cause === null, unavailableNote: cause ? UNAVAILABLE_NOTE[cause] : null,
          coverageNote: coverage?.note ?? null,
          capabilityNote: l.caseLaw && caseLawReady === false ? CASE_LAW_DARK_NOTE : null };
      }),
      // ── the TERRITORY affordance ─────────────────────────────────────────────────────────────
      //
      // The composer's Where field offers places this register cannot search. Sending the covered set
      // down lets it offer only what can be ordered — the same move as `available` on the product row,
      // one field lower.
      //
      // DISPLAY NAMES, computed server-side, because five vocabularies sit between a name on the form
      // and an office code (display → normalizeTerritory → canonicalJurisdictionCode → offices.translate
      // → covered.has) and register-plan.mjs:206-216 records what re-implementing that chain cost.
      //
      // THE FIELD IS OMITTED, not nulled, when the snapshot does not say. `null` is a real answer here
      // ("no declared restriction") and the browser must be able to tell it from "this deployment has
      // not told me", which fails open. A `covered ?? []` anywhere on this path offers zero territories
      // on a production box.
      ...(territories === undefined ? {} : { territories }),
      // `base` and `nativeLanguage` ride the LIST row, not just the record: the composer has to say what
      // geography a saved search accepts while the row is being clicked, and fetching the record per
      // selection would put that answer one round trip behind the Review button. Only `true` travels for
      // the toggle, exactly as at the recipe door.
      recipes: [...recipes.entries()]
        .filter(([k, r]) => k.startsWith(`${account}/`) && !r.archived)
        .map(([k, r]) => ({ slug: k.split("/")[1], label: r.label, base: r.base, version: r.version ?? null, nativeLanguage: r.nativeLanguage === true })),
      // ── — THE MARK-NAME BUDGET, SENT RATHER THAN DUPLICATED ──────────────
      //
      // The owner typed a product description into the mark-name field and the product accepted it,
      // priced it, ran it, and built the run's identity from it. The intake refuses that now — one rule
      // at every door — but a refusal a reader meets AFTER confirming is a round trip they should not
      // have paid for, so the screen has to know the same number.
      //
      // SENT, not hardcoded in the client, for the reason `read.maxBrief` beside it is sent: two copies
      // of a budget drift, and the one that drifts is the one nobody runs. `PLAN_MAX_NAME_LENGTH` is
      // the product's existing answer and stays the only one.
      maxMarkName: PLAN_MAX_NAME_LENGTH,
      // Whether the Describe-it half of the composer can actually read. Rides the capability payload
      // the composer already fetches rather than getting its own probe: one round trip decides what the
      // whole screen offers, and a second one would be a second thing to go stale.
      read: {
        available: Boolean(composeRead),
        maxBrief: MAX_BRIEF,
        // Never names the missing variable. This is a client-facing string on a client-facing screen,
        // and "ANTHROPIC_API_KEY is unset" tells a client about our plumbing to no purpose.
        note: composeRead ? null : READ_OFF_NOTE,
      },
    };
  };

  // assemble the SERVER-stamped candidate job for plan/run (identity fields never from the body)
  //
  // THE SPLIT THIS FUNCTION ENFORCES: identity is stamped, everything else is carried.
  //
  // `profileKey`, `forwarder` and `forwarderEmail` come from the verified principal and are never read
  // off the body — that is the tenancy wall, and it is the reason a client cannot file a clearance
  // against another brand owner by editing a request. Every OTHER field below is the user's to set, and
  // is passed through VERBATIM for `validateJob` to rule on. This function deliberately owns no
  // vocabulary of its own: shape, caps, dedupe and normalisation live in the one validator all three
  // doors share, so the portal cannot drift from the CLI or the MCP face.
  //
  // `customer` is NOT carried, and its absence is the considered answer rather than an oversight. It
  // names the APPLICANT for the self-exclusion check — the rule that stops a client's own filings being
  // reported back as conflicts. On this door the applicant is already known: the account resolved it,
  // and the profile behind it is staff-curated. Letting a body re-state it would let a client widen or
  // silence their own exclusion, which is a rating-authority change wearing a scope field's clothes.
  const jobFor = ({ principal, account, body }) => {
    const marks = Array.isArray(body.marks)
      ? body.marks.map((m) => (typeof m === "string" ? { name: m } : m)).filter((m) => m?.name && String(m.name).trim())
      : undefined;
    const text = (v, max) => (v != null && String(v).trim() ? String(v).slice(0, max) : undefined);
    const job = {
      id: `portal-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      profileKey: account,
      forwarder: "portal", forwarderEmail: principal.email,
      markName: body.markName != null ? String(body.markName) : marks?.[0]?.name,
      marks, classes: Array.isArray(body.classes) ? body.classes.map(Number).filter(Number.isFinite) : undefined,
      goods: text(body.goods, 2000),
      ...(body.product ? { product: String(body.product) } : {}),
      ...(body.recipeKey ? { recipeKey: String(body.recipeKey) } : {}),
      // spec 62 — the engagement this clearance belongs to. validateJob checks it names a real project
      // UNDER the resolved customer and clarifies otherwise, so a stale selection cannot silently fall
      // back to the customer profile on a paid run.
      ref: text(body.ref, 200),
      projectKey: text(body.projectKey, 64),
      // per-run SCOPE — where the machinery points, as against product/recipeKey which choose WHICH
      // machinery runs. jurisdictions REPLACE the account's territories; platforms are ADDED to its
      // marketplaces and can never remove one (the floor rule).
      jurisdictions: Array.isArray(body.jurisdictions) ? body.jurisdictions.map(String) : undefined,
      platforms: Array.isArray(body.platforms) ? body.platforms.map(String) : undefined,
      // THE GEOGRAPHY STAMP, carried from the composer rather than inferred here. "worldwide" is a
      // positive instruction that the account's own territories may not narrow, and it is byte-identical
      // to silence without this field — which is how a screen promised "everywhere" and ran seven
      // countries. Validated against the territory list by validateJob, never silently reconciled.
      // THE MODE ONLY. `origin` is WHICH LAYER supplied the territories, and validateJob derives it from
      // the mode at the one door all four share ("account-default" for that mode, "request" otherwise).
      // Stamping "request" here regardless made this the one door that recorded the requester as having
      // named territories they explicitly deferred to the account for — a provenance claim about a
      // person who never made it, and a stored request that differed from the other doors' byte for byte.
      ...(body.geography && typeof body.geography === "object" && !Array.isArray(body.geography)
        ? { geography: { mode: String(body.geography.mode ?? "") } } : {}),
      // The one toggle in the offering, carried STRAIGHT THROUGH — `false` included. The composer only
      // ever sends `true`, and the old rule here ("only true is forwarded") was written from that: an
      // explicit false implies a suppression that does not exist, so it was dropped. But dropping it is
      // the accept-and-drop shape on the sibling of the field two lines below, which this same door
      // carries verbatim for exactly that reason. A hand-rolled POST sending `false` believed it had
      // switched the investigation off; validateJob now refuses it, in products.mjs's own words.
      ...("nativeLanguage" in body && body.nativeLanguage != null ? { nativeLanguage: body.nativeLanguage } : {}),
      // `deliveryRoute` IS CARRIED, and its absence here was THE defect of this round.
      //
      // It is a DECLARED job field with a refusal sentence of its own (enqueue-schema PORTAL_ROUTE_-
      // UNAVAILABLE), refused by name at start_run, the CLI, plan_run and the runner's wall. This door
      // did not name it, so `deliveryRoute: "portal"` was gone before validateJob or the door gates could
      // see it: /plan returned 200, /run returned 200, `trigger` was handed a job with no deliveryRoute
      // key at all, and the run WENT OUT BY EMAIL with nothing said. The guarantee: a portal request
      // must never silently go out by email.
      //
      // Carried rather than judged here: this function owns no vocabulary (see the header), so the value
      // travels verbatim and the one sentence every other door quotes does the refusing.
      ...(body.deliveryRoute != null && String(body.deliveryRoute).trim() ? { deliveryRoute: String(body.deliveryRoute) } : {}),
      // `caseLaw` is carried STRAIGHT THROUGH so validateJob can refuse it — this door deliberately owns
      // no vocabulary of its own (see the header above). Dropping it here instead would make the portal
      // the one door that accepts the field and silently ignores it, which is both halves of the defect
      // at once: a requester told nothing, and three doors answering one question differently.
      ...("caseLaw" in body && body.caseLaw != null ? { caseLaw: body.caseLaw } : {}),
      // Copied on PRESENCE, null included — validateJob refuses the key itself, and a door that
      // dropped it would leave the requester believing their depth selector was honoured.
      ...("searchLevel" in body ? { searchLevel: body.searchLevel } : {}),
      // advice posture — what the searcher needs to know to weigh a hit, not what to search.
      upfrontInstructions: text(body.upfrontInstructions, 4000),
      commercialFlexibility: text(body.commercialFlexibility, 2000),
      priorUse: text(body.priorUse, 2000),
      // P2-C (Round-2 §8a): campaign-shape FACTS (house-brand attachment / duration / scale, verbatim from
      // the client) — recorded at intake so the matter frame never has to invent the launch shape.
      campaignShape: text(body.campaignShape, 2000),
      deadline: text(body.deadline, 40),
      // — `msgId: null, conversationId: null` used to sit here. They are the email door's fields;
      // this door has no message and no thread, so writing a constant and stripping it at the trigger
      // hop was two operations that cancelled out while the declaration above claimed they were carried.
      // They are in `notCarried` now, with the reason.
    };
    for (const k of Object.keys(job)) if (job[k] === undefined) delete job[k];
    return job;
  };
  const selectorOf = (body) => (body.recipeKey ? `recipe:${body.recipeKey}` : `product:${body.product || "the account's default"}`);

  async function route(method, path, identity, body = {}, query = {}) {
    const principal = makePrincipal({ email: identity?.email, grants: grantsNow(), staffDomains });
    const parts = path.replace(/\/+$/, "").split("/").filter(Boolean);   // ["portal", ...]
    if (parts[0] !== "portal") return { status: 404, json: { error: "not_found" } };
    try {
      // /portal/api/me
      if (parts[1] === "api" && parts[2] === "me" && method === "GET") {
        assertPrincipal(principal, { door: true });   // door check only — a multi-account client enters and gets the picker list
        // `accountNames` — the DISPLAY name of each account this identity holds, and nothing else.
        //
        // Every profile carries a name ("Vantor Labs", "Aurora Interactive"); the account KEY is a
        // slug ("vantor"). Staff read names because the account picker fetches the staff-only
        // roster; a client had no name source at all, so the identical screen printed the slug at them.
        // The same brand owner therefore read two different ways depending on who signed in, which is
        // what this field ends.
        //
        // SCOPED TO THE GRANTED ACCOUNTS, never the roster. A name map covering everything would put
        // Cordillera's customer list on the one route every signed-in identity can reach — the exact
        // leak /profiles is never proxied for (portal-upstream: "a client reaching it would learn the
        // customer base"). `"*"` identities get {} and keep using the roster, which is staff-gated.
        let accountNames = {};
        if (Array.isArray(principal.accounts) && principal.accounts.length) {
          try {
            const profiles = await loadProfilesImpl();
            for (const key of principal.accounts) {
              const name = profiles.get(key)?.name;
              if (typeof name === "string" && name) accountNames[key] = name;
            }
          } catch {
            // A name is a nicety; the door is not. An unreadable profile store must not lock a user
            // out of the portal, so this degrades to the keys the UI already falls back to.
            accountNames = {};
          }
        }
        // HOW MANY RUNS THIS DEPLOYMENT EXECUTES AT ONCE. Deployment-wide, not account-scoped, which is
        // why it rides here rather than on /usage: it is the same number for everyone, /me is fetched
        // once by every screen, and a multi-brand account has no single /usage to read it from.
        //
        // Home states it in its section header. It was written into the UI as a literal `2` — right on
        // the day, and silently wrong the moment CLEAROTRON_MAX_CONCURRENT_RUNS is set to anything else,
        // which is exactly the shape of over-promise this screen exists to avoid.
        // WHO OPERATES THIS DEPLOYMENT. The portal named the operator in three places as a
        // string literal — the role label was the operator's own name, which a fork would have shipped
        // about a company it has nothing to do with. `CLEAROTRON_BRAND_NAME` has been the brand seam all
        // along and TRADEMARKS.md already listed portal nav as a consumer; it simply was not one.
        // Riding on /me because that is where the ROLE comes from, and the label is role plus operator.
        // WHICH MODE THIS INSTALL IS. Same rationale as concurrentRuns above: it is the
        // same answer for everyone, /me is fetched once by every screen, and the screen that needs it
        // most — New clearance — has no other deployment-wide source.
        //
        // READ, NEVER COMPUTED. This process deliberately has no engine environment (see this file's
        // own header, three times over), so `engineInventory(process.env)` here would report demo on
        // every install — a confident wrong answer. `flagView` reads the snapshot `bin/start.mjs`
        // writes at boot and derives the mode from `binaryPresent`, which that snapshot already
        // carries. NULL when there is no snapshot to read, and null means THIS CANNOT ANSWER — the UI
        // must leave the button alone rather than infer demo from an absent file.
        return { status: 200, json: { role: principal.role, email: principal.email, accounts: principal.accounts, accountNames,
          concurrentRuns: concurrentRunsCap(), brand: BRAND.name, engineMode: flagView(poolRoot).engineMode,
          // — a button that always fails must not render as available. The reason is
          // operator-shaped and staff-only; a client reads the generic sentence the button carries.
          controls: { stop: { available: stopControl.available !== false,
            reason: principal.role === "staff" ? (stopControl.reason ?? null) : null } } } };
      }
      // /portal/api/about — the AGPL §13 source offer (,)
      //
      // UNAUTHENTICATED, DELIBERATELY, and it is the only route here that is. §13 obliges an operator
      // running a modified version to offer the source to the users interacting with it — the offer is
      // owed to whoever reaches the service, and a licence notice you must first sign in to read is not
      // an offer. Nothing here is private either: the product's name, its version, its licence and the
      // commit it is running are all facts about code that is published under a licence requiring
      // exactly that. The sha is not a secret; it is the thing being offered.
      //
      // SERVED, NOT BUILT. The bundle cannot carry its own commit — portal-ui/dist is committed and CI
      // fails when dist and source disagree, so a hash baked in at build time is not known until after
      // the commit that would carry it. The server knows what it is running; the page asks.
      if (parts[1] === "api" && parts[2] === "about" && method === "GET") {
        return { status: 200, json: productIdentity() };
      }
      // /portal/api/searches
      if (parts[1] === "api" && parts[2] === "searches" && method === "GET") {
        const account = assertPrincipal(principal, { account: query.account ?? null });
        if (!account) return { status: 400, json: { error: "name an account (?account=) — staff must pick who they act for" } };
        return { status: 200, json: { account, ...searchesFor(account) } };
      }
      // /portal/api/compose/read — turn a pasted brief into a filled-in composer.
      //
      // THE ONE THING TO KEEP TRUE ABOUT THIS ROUTE: it is the only POST under /portal/api that is not
      // a step towards spending money. It mints no confirmation token, writes nothing, queues nothing
      // and returns a draft. If it ever grows a side effect, it stops being safe to leave un-gated
      // behind the composer's first click and belongs beside plan/run instead.
      if (parts[1] === "api" && parts[2] === "compose" && parts[3] === "read" && method === "POST") {
        // Door check only. The read touches no account data, so demanding an account here would be a
        // gate with nothing behind it — and a staff member composing for a client they have not yet
        // picked would be refused a form-filler for no reason.
        assertPrincipal(principal, { door: true });
        // `error` carries the SENTENCE, `code` the machine word — the convention every other route on
        // this service follows, and what portal-ui's decoder reads. A code in `error` reaches a client
        // screen as the literal word "read_failed".
        if (!composeRead) {
          return { status: 501, json: { code: "unavailable", error: READ_OFF_NOTE } };
        }
        if (readBudget && !readBudget.take(principal.email)) {
          return { status: 429, json: { code: "rate_limited", error: "That is a lot of reading in one hour — set this one up below." } };
        }
        let out;
        try {
          out = await composeRead(typeof body?.brief === "string" ? body.brief : "");
        } catch (e) {
          // A provider outage is not a portal fault and must not read as one. The composer shows the
          // sentence and keeps every field the user already typed — the brief is still in the box.
          audit({ event: "compose-read", by: principal.email, ok: false, error: String(e?.message ?? e) });
          return { status: 502, json: { code: "read_failed", error: "The reader is not answering just now — set the search up below." } };
        }
        // Length, never content. A brief is client material — whose mark, for whose product, before
        // whose deadline — and an audit log is a different disclosure surface from a run store.
        audit({ event: "compose-read", by: principal.email, ok: out.ok === true,
          chars: String(body?.brief ?? "").length, ...(out.ok ? {} : { error: out.error }) });
        if (!out.ok) {
          // "engine" IS AN UPSTREAM FAULT AND KEEPS ITS 502. Before this the reader
          // built its own client and a provider outage THREW, landing in the catch above as a 502. Going
          // through the engine door made it a returned refusal instead — total rather than throwing — and
          // routing that to 422 would have told the user their brief was unprocessable when the engine
          // was simply unreachable. Same fault, same status as before; the reader changed, not the
          // meaning. `unreadable` and `shape` stay 422 beside it: those ARE answers, just untrustworthy
          // ones, and 422 is what this route has always said about them.
          if (out.error === "engine") {
            audit({ event: "compose-read", by: principal.email, ok: false, error: out.cause ?? "engine" });
            return { status: 502, json: { code: "read_failed", error: out.message } };
          }
          const status = out.error === "too_long" || out.error === "empty" ? 400 : 422;
          return { status, json: { code: out.error, error: out.message } };
        }
        return { status: 200, json: { read: out.read } };
      }
      // shared plan-time gates — run at BOTH doors so a body that would 422 at plan can never be
      // submitted at run behind a token minted for a clean body (review 2026-07-18)
      const planGates = (job) => {
        // Availability FIRST, before validation spends any effort on a job that cannot run whatever it
        // says. This is the door that used to be missing: /plan happily minted a confirmation token for
        // a knockout on a box that reported knockout unavailable, and the user found out only after
        // pressing Start — a spend-shaped button that could never spend, which reads as a broken product
        // rather than an unavailable one. Refusing here means the composer and the gate agree.
        //
        // The recipeKey arm that used to sit here (a 422 when saved searches were "not switched on") went
        // with CLEAROTRON_RECIPES_MODE on 2026-07-27: a saved search is now honoured wherever it resolves.
        // Asked of the RESOLVED product, not of the body: a request that names none resolves through
        // the account's default and its own territories, and the old read (`body.searchLevel || "prelim"`)
        // answered about a product nobody had chosen. `resolveFor` fails open to a null resolution, and a
        // null one is not judged here — validateJob and the scope rules below still run, and the runner
        // is the wall.
        {
          const { resolved } = resolveFor(job);
          const cause = resolved && !resolved.clarify
            ? productAvailability(policyFor(resolved.product), {
              built: readBuilt(), registerCanCount: readCanCount(),
              registerTerritories: readTerritories(), geography: productRow(resolved.product)?.geography ?? null,
              demo,   // — the wall reads the same cause the label does
            })
            : null;
          if (cause) {
            // The registry's NAME, never the internal key — the report-identity rule. It leads here for
            // the same reason it leads everywhere else: "Knockout search is unavailable" names something
            // a client can act on, "Depth 2 is unavailable" names our pricing ladder.
            const row = productRow(resolved.product);
            return { fail: { status: 422, json: { ok: false, errors: [`${row?.name ?? "That search"} is unavailable. ${UNAVAILABLE_NOTE[cause]}`] } } };
          }
        }
        const probe = { ...job, msgId: `<plan@portal>`, conversationId: job.id };
        const v = validateJob(probe);
        // validateJob NORMALIZES IN PLACE (the dedupe, the bare-string fix, the worldwide token), and it
        // was doing it to a throwaway copy — so the review summary and the rules below read a scope the
        // runner would never receive. A literal "Worldwide" survived here as a one-element territory
        // list, which frames as scope AND counts as one territory against the deep-dive rule: the guard
        // would have waved a worldwide deep dive straight through. Carried back instead. Safe against
        // the confirmation token: jobHashOf does not cover jurisdictions, so plan and run still agree,
        // and a cleared list means the runner applies the account's defaults — what the wall would have
        // done with the token anyway.
        if ("jurisdictions" in probe) job.jurisdictions = probe.jurisdictions; else delete job.jurisdictions;
        // AND THE GEOGRAPHY STAMP WITH IT. validateJob writes it (worldwide / named / account-default),
        // and carrying back only the territories left the real job unstamped — so `resolveEffectiveScope`
        // read "unrecorded" and a worldwide request fell straight back through to the account's own
        // territories at this door, while the CLI and start_run honoured it. That is the same defect this
        // build exists to end, surviving inside the one door that gates the money button.
        if ("geography" in probe) job.geography = probe.geography; else delete job.geography;
        if (!v.ok) return { fail: { status: 422, json: { ok: false, classify: v.classify, errors: v.errors } } };
        const collisions = kebabCollisions((job.marks ?? [{ name: job.markName }]).map((m) => m.name));
        if (collisions.length) return { fail: { status: 422, json: { ok: false, errors: [`marks ${collisions.map(([a, b]) => `"${a}"/"${b}"`).join(", ")} are duplicates or differ only in punctuation — reword or drop one`] } } };
        // The (product × scope) combination rules, said HERE so a client reads them on the review step
        // instead of watching a run park itself minutes later. The runner is the wall; this is the
        // courtesy. It reads the SAME resolution the review step prints from (`resolveFor`), which is
        // what keeps a refusal from contradicting the scope shown beside it. Fails OPEN by the same rule
        // that resolution does: a profile or recipe store the resolver cannot read must not stop someone
        // starting a search.
        let rules = { errors: [], warnings: [] };
        try {
          const { profile, resolved } = resolveFor(job);
          if (!profile && !resolved) throw new Error("resolution unavailable");
          // EVERY resolved-product check, not just the combination rules. This door had `resolveFor(job)`
          // in hand and budgeted nothing on it, so a two-name request under an account whose default
          // product is a clearance passed the money button and parked at the wall (Finding 2c).
          // `availability:false` — the branch above already refused it in the client's own words, and the
          // staff-prose twin must never reach a browser (door-gates.mjs header).
          rules = gateResolvedRequest({ job, profile, resolved, readable: true }, { availability: false });
          // classify:"clarify", exactly as validateJob's own 422 above does it and as the runner files the
          // identical rule. A 422 without it decodes as a collision (contract/api.ts), which the composer
          // renders under "That cannot be searched as written" — a dead end, for a rule whose whole answer
          // is one field: name the territories the product reads, or order the product that reads these.
          if (rules.errors.length) return { fail: { status: 422, json: { ok: false, classify: "clarify", errors: rules.errors } } };
        } catch (e) {
          // Unreadable config never blocks a run here — the wall still holds. Audited rather than
          // swallowed: a deployment pointed at the wrong profile store loses this gate for EVERY account,
          // and silence is how that goes unnoticed (the roster-blindness class of incident).
          audit({ event: "plan-gate-skipped", gate: "scope-rules", error: String(e?.message ?? e) });
        }
        return { warnings: [...(v.warnings ?? []), ...rules.warnings] };
      };
      /**
       * The daily allowance, checked at the doors so the refusal arrives BEFORE the money button.
       *
       * This is the courteous layer, not the control. The runner's admission gate is the wall — it
       * covers every door including email and CLI, and it is what actually stops a run. Checking here
       * as well means a client who is out of allowance is told so on the review step, in a sentence
       * that says when it resets, instead of pressing Start and watching a run park itself minutes
       * later. The two can disagree by a run under concurrency; the wall is the one that decides, and
       * it refuses by CLARIFYING rather than dropping, so nothing is ever lost to the gap.
       *
       * Staff are never checked: role is decided by the principal, here, where it is authoritative.
       */
      // WHICH PRODUCT IS THIS, AND WHERE WOULD IT POINT — asked ONCE, and everything the plan says
      // derives from that one answer: the availability gate, the name, the scope shown at review, and the
      // effort figure the run is stamped with.
      //
      // The resolution used to live inside effortFor, so the plan door quoted effort off the RESOLVED
      // policy while naming the product from the body's own selector — a second, cruder answer that never
      // consulted the customer's own default and was null outright on the recipeKey arm. The two
      // disagreed exactly where it mattered most: a saved search showed the headline "saved search" over
      // an effort figure quoting a recipe, and an account whose profile defaults to a knockout was shown
      // a full-clearance headline for a quick screen.
      //
      // Fails OPEN to nulls: this feeds a description shown beside the real gates, and a profile store
      // the resolver cannot read must not stop someone starting a search. The runner is the wall.
      // ONE implementation, shared with every other door (door-gates.mjs resolveForDoor). It was written
      // here first and copied nowhere, which is why start_run and the CLI resolved nothing at all.
      const resolveFor = resolveForDoor;
      const effortFrom = ({ job, profile, resolved }) => {
        if (!profile || !resolved || resolved.clarify) return null;
        try { return quoteForJob({ job, profile, searchPolicy: resolved }); } catch { return null; }
      };

      const quotaRefusal = async (account) => {
        if (principal.role !== "client" || !upstream) return null;
        let caps = null, capsRead = false;
        try {
          const r = await upstream.getProfile(principal, account);
          if (r.status === 200) { caps = r.json?.readOnly?.runCaps ?? null; capsRead = true; }
        } catch { return null; }   // cannot read the cap ⇒ do not invent one; the wall still holds
        // The same DEFAULT the wall applies (runner.mjs DEFAULT_CLIENT_DAILY_RUNS): a profile READ
        // successfully with no dailyRuns is capped, not uncapped. Mirrored rather than imported because
        // portal-service must not pull the runner into a request path; a test pins the two constants.
        // An UNREADABLE profile is different and gets no pre-check at all — inventing a limit we could
        // not read would refuse a client whose profile may say something larger. The wall still holds.
        if (!capsRead) return null;
        const limit = Number.isInteger(caps?.dailyRuns) ? caps.dailyRuns : DEFAULT_CLIENT_DAILY_RUNS;
        if (!Number.isInteger(limit)) return null;
        const used = accountUsage({ queueDirs: queueDirs(), account });
        // A COUNT WE COULD NOT TAKE IS NOT A ZERO. `complete: false` means no ledger was reachable, and
        // 0 would then mean "nothing recorded" and "nothing readable" at once — the exact confusion that
        // made this refusal unreachable for as long as the path was wrong. Same call the branch
        // above already makes for an unreadable profile, for the same reason: this is a pre-check whose
        // only job is a better sentence, the runner's checkRunCaps is the actual control, and refusing a
        // client on evidence we do not have costs them a search we cannot show they spent. So it stays
        // quiet — but it says so in the audit trail rather than silently, because a gate that cannot read
        // its input is an operational fact, not a non-event.
        //
        // `basis` rides along because "no-ledger" and "unreadable" are fixed by different people: the
        // first is a queue this service was never pointed at, the second is a file it cannot open. One
        // row per request while a deployment is misconfigured, at both call sites, is the intended
        // volume — a gate that has been blind since boot should be as loud as the traffic it is blind to.
        if (!used.complete) {
          audit({ event: "quota-precheck-blind", by: principal.email, account, basis: used.basis });
          return null;
        }
        if (used.today + 1 <= limit) return null;
        return { status: 429, json: { ok: false, errors: [
          `You have used all ${limit} of this account's searches for today. The allowance resets at midnight UTC — or ask your ${BRAND.name} contact to run this one for you.`,
        ] } };
      };

      // /portal/api/run/plan — the confirmation gate (no spend)
      if (parts[1] === "api" && parts[2] === "run" && parts[3] === "plan" && method === "POST") {
        const account = assertPrincipal(principal, { account: body.account ?? query.account ?? null });
        if (!account) return { status: 400, json: { error: "name an account — staff must pick who they act for" } };
        const job = jobFor({ principal, account, body });
        const gates = planGates(job);
        if (gates.fail) return gates.fail;
        const overQuota = await quotaRefusal(account);
        if (overQuota) return overQuota;
        // ONE resolution, and the name, the stage, the turnaround and the effort all come off it.
        const { profile: planProfile, resolved: planResolved, scope: planScope } = resolveFor(job);
        const planRow = productRow(planResolved?.product);
        // `name` leads. stageLabel stays on the wire for an older bundle, which
        // reads `name || stageLabel` — and for a resolution that clarified, where there is no row and
        // "saved search" is still the honest thing to call it.
        const name = planRow?.name ?? null;
        const stageLabel = planRow?.stageLabel ?? planResolved?.stageLabel ?? "saved search";
        const nMarks = countJobMarks(job);
        const selector = selectorOf(body);
        // WHAT WOULD ACTUALLY BE SEARCHED, resolved by the same ladder plan_run uses. Without this the
        // review step could show a depth and a mark count while saying nothing about the territories or
        // marketplaces the user had just picked — a summary that omits the thing being confirmed is a
        // worse gate than none, because it looks like it checked.
        const scope = planScope;
        const token = mintConfirmation({ secret, account, email: principal.email, jobHash: jobHashOf(job) });
        audit({ event: "plan", by: principal.email, account, selector, marks: nMarks });
        // ── — THE LIMIT, STATED WHERE THE TICKET IS SPENT ─────────────────
        //
        // The issue's ruling is that the coverage limit is "stated at the point of choosing"; this is
        // the OTHER point, and it is the one that matters most. A worldwide search is orderable on a
        // partial register now, and the review step is the last thing a reader sees before money is
        // committed — so "you are buying a worldwide search that will not reach most of the world"
        // belongs here rather than in the report they read afterwards.
        //
        // It also puts the honest reading of the QUOTE in front of them: `run-quote.mjs` sizes the
        // turnaround from the territories ASKED FOR, not from the ones the register will reach, so the
        // hours quoted for a worldwide search on a partial register overstate the work. That is not a
        // bill — the quote is hours, and nothing on this path converts to currency — and it is recorded
        // on the issue rather than silently adjusted here.
        const planCoverage = coverageDisclosure(planRow?.geography ?? null, readTerritories());
        return { status: 200, json: { ok: true, account, selector, name, stageLabel, marks: nMarks,
          coverage: planCoverage ? { reached: planCoverage.reached, missing: planCoverage.missing, note: planCoverage.note } : null,
          // The PRODUCT's floor, and the client reads `effort.turnaround` in preference to it — that one
          // is computed against THIS request (names, lanes, territories) where this is the product with
          // nothing added. Kept as the degraded answer for when the quote cannot be taken. Read off the
          // SAME resolution as the name above, so the two cannot describe different products.
          turnaround: baseTurnaroundFor(policyFor(planResolved?.product)).text,
          warnings: gates.warnings, scope,
          effort: effortFrom({ job, profile: planProfile, resolved: planResolved }),
          confirmationToken: token, note: "Nothing runs until you confirm. Review the summary, then start the search." } };
      }
      // /portal/api/run — verify + trigger (the ONLY spend path)
      if (parts[1] === "api" && parts[2] === "run" && parts.length === 3 && method === "POST") {
        const account = assertPrincipal(principal, { account: body.account ?? null });
        if (!account) return { status: 400, json: { error: "name an account" } };
        const job = jobFor({ principal, account, body });
        const gates = planGates(job);   // re-gated: the token is necessary, never sufficient
        if (gates.fail) return gates.fail;
        // re-checked for the same reason the gates are: a token minted while the account still had
        // allowance must not spend it after another tab has used the last one.
        const overQuota = await quotaRefusal(account);
        if (overQuota) return overQuota;
        sweepJtis();
        const bad = verifyConfirmation({ secret, token: body.confirmationToken, account, email: principal.email,
          jobHash: jobHashOf(job), usedJtis });
        if (bad) return { status: 409, json: { ok: false, error: bad } };
        const selector = selectorOf(body);
        // ── — A DEMO WALKS THE REAL FLOW AND LANDS ON A FINISHED RUN ─────────
        //
        // Owner ruling, 2026-08-31, revising his own ruling of an hour earlier: "i think its OK for
        // someone to be able to press New Clearance in demo mode and see it work and get the static
        // results, right?" — so the form is real, the plan is real, the confirmation is real, and the
        // only thing that is not real is the dispatch.
        //
        // EVERYTHING ABOVE THIS LINE HAS ALREADY RUN: the gates, the quota, and the confirmation token.
        // That is deliberate rather than incidental — "walks the real flow" means the same validation
        // and the same refusals a real order meets, and a demo that skipped them would be the separate
        // viewer this whole track exists to retire. What it must never do is reach `trigger`, and this
        // returns before it: no engine turn, no register call, no queue entry, no run directory.
        //
        // THE MAPPING IS STATED, NOT CLEVER, in the ruling's own words: which finished run the visitor
        // lands on follows from WHICH SEARCH THEY PICKED. "Picking the fourth product and receiving the
        // first one's report would teach the wrong thing about all four."
        //
        // SO A PRODUCT WITH NO FINISHED EXAMPLE REFUSES, and says which one. That is the honest state of
        // a pool that holds fewer than four — today it holds one — and it is what keeps the mapping's
        // promise while the rest are captured. Landing somewhere approximate would break exactly the
        // rule the ruling spends a paragraph on.
        //
        // RESOLVED THROUGH THE SAME OWNERSHIP SCAN EVERY OTHER SURFACE USES, so a demo can never land on
        // a run this principal could not otherwise open. There is no demo-only read path here.
        if (demo) {
          const { resolved } = resolveFor(job);
          const want = resolved && !resolved.clarify ? resolved.product : null;
          const row = productRow(want);
          const finished = scanAccountRuns({ poolRoot, workspaceRoot, account, queueDirs: queueDirs() })
            .filter((x) => x.state === "delivered" && x.product === want);
          if (!finished.length) {
            audit({ event: "demo-order", by: principal.email, account, selector, product: want ?? null, landedOn: null });
            return { status: 409, json: { ok: false, errors: [
              `This demo does not carry a finished ${row?.name ?? "search"} to show you yet. `
              + `Nothing was started and nothing was charged — every search here resolves to a report that `
              + `already exists, and this one has not been captured. Pick a search the demo has a report for.`,
            ] } };
          }
          // NEWEST FIRST, by the same comparison the listing sorts on, so two examples of one product
          // resolve predictably rather than by directory order.
          const landed = [...finished].sort((a, b) =>
            String(b.issuedAt ?? b.date ?? "").localeCompare(String(a.issuedAt ?? a.date ?? "")))[0];
          audit({ event: "demo-order", by: principal.email, account, selector, product: want ?? null, landedOn: landed.runId });
          // `queued: false` and a NAMED landing, because the one thing this must not do is read like a
          // run that just started. The report it opens is dated as it is and says on its own face that
          // it is an example; the response says the same thing to the client that navigates there.
          return { status: 200, json: { ok: true, queued: false, id: landed.runId,
            landedOn: landed.runId, landedProduct: want ?? null } };
        }
        let r;
        try {
          // FORWARD THE WHOLE JOB, not a hand-picked subset. This call used to name eight fields, so
          // anything else the composer sent was validated at the plan gate, shown back in the review
          // step, hashed into the confirmation token — and then dropped on the floor here. A field that
          // survives every check and vanishes at the last hop is the worst shape available: the user is
          // told it was accepted and the report is quietly narrower than the one they confirmed.
          // Enumerating fields at a pass-through hop guarantees the list rots; the job is already
          // server-stamped and validated, so it goes as it is.
          // — this used to destructure `msgId` and `conversationId` off the job before forwarding.
          // `jobFor` no longer mints them (it is an allow-list, so no body value can put them here
          // either), and a strip that can never remove anything reads as though the job might carry
          // them. It cannot. The comment above is the rule: forward the whole job.
          // — THE DEPLOYMENT DECLARES A DEMO RUN, READ FROM THE ACCOUNT'S OWN
          // PROFILE. The rule `demoRun` lives under is that a REQUESTER may not decide whether their own
          // report is fiction. It is not that a demo account cannot be run from the portal — and its own
          // words are "operator doors declare it, the client door does not". THIS HOP IS THE OPERATOR
          // DOOR: it calls `start_run` with the ops token, and `START_RUN_JOB_FIELDS.carries` lists
          // `demoRun` for exactly that reason. The requester still never supplies it; the account's own
          // profile does, which is the deployment's statement about the account.
          //
          // WITHOUT THIS, `demoRunAgreement` sees a demo profile and an ordinary job and REFUSES every
          // portal submission on a `demoData` account — so the demo account, which exists to be shown,
          // was the one account the UI could not run. Measured 2026-09-02 on demo-brand-owner.
          //
          // FAIL CLOSED. A profile that cannot be read leaves the flag unset and the run is refused by
          // the agreement wall in its own words. The dangerous direction is the opposite one — marking a
          // REAL account's report as fiction — and an unreadable profile must never be able to reach it.
          let demoRunFlag = false;
          try { demoRunFlag = (await loadProfilesImpl()).get(account)?.demoData === true; }
          catch { demoRunFlag = false; }
          r = await trigger({
            ...job,
            profileKey: account,
            // The daily-allowance stamp. Set ONLY here, and only on a genuine client principal —
            // this is the one place in the system where that role is authoritative. See checkRunCaps
            // for why the polarity is positive-only and why every inferred alternative fails unsafely.
            ...(principal.role === "client" ? { clientPrincipal: true } : {}),
            ...(demoRunFlag ? { demoRun: true } : {}),
          });
        } catch (e) {
          // an upstream refusal is AUDITED in full — never an opaque 500 with no trace
          const detail = String(e?.message ?? e).slice(0, 300);
          audit({ event: "trigger", by: principal.email, account, selector, id: job.id, ok: false, error: detail });
          // …but the AUDIT is where the detail belongs, not the response. Upstream messages are written
          // for operators and name infrastructure: the unwired-trigger case reads "PORTAL_MCP_URL /
          // PORTAL_OPS_TOKEN unset", which is an internal variable name rendered in a client's browser.
          // Staff get it verbatim because they are the ones who can act on it; a client gets the fact.
          const staff = principal.role === "staff";
          // One cause is worth distinguishing even for staff: an instance with no engine attached is not
          // a failure, it is an instance that was never finished. Saying "could not be queued" invites
          // someone to retry, re-read logs and file a bug against a working system.
          const unwired = /trigger lane is not wired/i.test(detail);
          const error = unwired
            ? (staff
              ? `this instance has no search engine attached (${detail}) — nothing was started`
              : `Searches cannot be started from this instance yet. Nothing was started, and nothing was charged.`)
            : (staff
              ? `the run could not be queued (${detail}) — nothing was started`
              : `The run could not be started just now. Nothing was started, and nothing was charged — ${BRAND.name} can see what happened.`);
          return { status: 502, json: { ok: false, error, unwired } };
        }
        audit({ event: "trigger", by: principal.email, account, selector, id: job.id, ok: Boolean(r?.ok ?? r?.queued) });
        return { status: 200, json: { ok: true, queued: true, id: job.id, upstream: r ?? null } };
      }

      // ── STOPPING ───────────────────────────────────────────────────────────────────────────────
      // Deliberately NOT behind the confirmation-token dance. That gate exists to stop money being
      // spent by accident; stopping is its opposite, and asking someone to confirm twice while a run
      // they no longer want keeps billing would be the wrong instinct wearing a safety hat.
      //
      // /portal/api/run/<runId>/stop — end a run that has already started.
      if (parts[1] === "api" && parts[2] === "run" && parts[3] && parts[4] === "stop" && method === "POST") {
        const account = assertPrincipal(principal, { account: query.account ?? null });
        if (!account) return { status: 400, json: { error: "name an account (?account=)" } };
        const runId = decodeURIComponent(parts[3]);
        // OWNERSHIP FIRST, and off the run list rather than off the request: the engine's own account
        // gate would refuse a foreign run anyway, but it would do so with an upstream error, and an
        // upstream error is a different observable from a 404. A run you may not touch must be
        // indistinguishable from one that does not exist.
        const mine = scanAccountRuns({ poolRoot, workspaceRoot, account, queueDirs: queueDirs() }).find((r) => r.runId === runId);
        if (!mine) return { status: 404, json: { error: "not_found" } };
        if (mine.state === "delivered" || mine.state === "failed" || mine.state === "cancelled")
          return { status: 409, json: { ok: false, error: "This run has already finished.", state: mine.state } };
        // ── — WHICH STOP THE READER ASKED FOR ────────────────────────────────
        //
        // Owner ruling, on his second encounter with the same wait: "a stop is a stop — maybe it should
        // be a 'stop immediately or at next boundary to preserve data' kind of question when you press
        // it." The driver half landed the mode; this carries the reader's answer to it.
        //
        // EXPLICIT `=== true`, so anything else is the boundary stop. This is the control that ends a
        // run mid-turn, and a truthy string arriving from a hand-rolled POST must not read as consent
        // to lose the step in flight. The safe path is the one an unrecognised body gets.
        const immediate = body?.immediate === true;
        let r = null;
        try {
          // — the human, forwarded. The portal has verified them (it is what every audit line on
          // this path already records); the engine cannot see them, because every UI stop arrives on one
          // shared ops token. Without this the run dir can say a stop came from the portal and never
          // which person pressed it, on a surface that travels into the archived matter record.
          r = await stopRun({ runId, immediate, onBehalfOf: principal.email });
        } catch (e) {
          const detail = String(e?.message ?? e);
          audit({ event: "stop", by: principal.email, account, runId, ok: false, error: detail });
          // The token is VERB-SCOPED, and a portal minted `--verbs start_run` cannot stop anything. That
          // refusal arrives from upstream looking like an engine fault, so name it as a posture problem
          // for operators while telling the user only that it did not happen.
          const unwired = /not wired|verb|scope/i.test(detail);
          return { status: 502, json: { ok: false, unwired,
            error: principal.role === "staff" ? detail : `The run could not be stopped just now. It is still running, and ${BRAND.name} can see what happened.` } };
        }
        // ── — WHICH STOP IS ACTUALLY IN PROGRESS, AND NOTHING ELSE ──────────
        //
        // The mode is read off the ANSWER, never off the press. An immediate stop that found no turn to
        // end IS a boundary stop, and the driver says so — presenting it as immediate because that is
        // what the button said would be the second silent thing in a row on this control, which is the
        // complaint this issue was opened with.
        //
        // AND THE RAW TOOL RESULT STOPS TRAVELLING. This route returned `upstream: r` wholesale, which
        // was harmless while the tool answered in states and sentences. It is not now: `stop_run`'s
        // immediate mode carries `immediate.pid` — a process id on the box — and this response goes to
        // a browser. Nothing in the client has ever read `upstream`; what a reader needs is which stop
        // is happening and the sentence the driver already composed for them.
        const mode = r?.immediate?.attempted && r?.immediate?.signalled ? "immediate" : "boundary";
        audit({ event: "stop", by: principal.email, account, runId, ok: Boolean(r?.ok), action: r?.action ?? null,
          // ASKED and TAKEN, both, because they differ exactly when something went wrong — a reader
          // pressed "stop now" and got the boundary stop, which is the row somebody will come looking
          // for. `why` is the driver's own words about its own machinery and stays on this side.
          stopAsked: immediate ? "immediate" : "boundary", stopTaken: mode,
          ...(immediate && mode === "boundary" ? { stopFellBack: r?.immediate?.why ?? r?.immediate?.error ?? "no reason given" } : {}) });
        return { status: 200, json: { ok: true, runId, action: r?.action ?? null,
          stop: { mode, note: typeof r?.note === "string" ? r.note : null } } };
      }

      // GET /portal/api/run/<runId>/summary — THE CROSS-MARK PARAGRAPH for a grouped run.
      //
      // A knockout over several names has no combined document, so its assessment — the one piece of
      // prose that reads the names against each other — is written to `report.md` and, until this route,
      // reached nobody: `meta.reports` lists the per-mark HTMLs only, and the pool path is not one the
      // edge serves. Owner ruling 2026-08-26: the grouped page carries it.
      //
      // ITS OWN ROUTE RATHER THAN A FIELD ON THE RUN ROW. The row is what /portal/api/runs returns for
      // every run the caller owns, and it is fetched by every screen that lists runs — where this prose
      // is never rendered. Riding it there would send a paragraph per batch to a browser that had no use
      // for it, on every listing, growing with the pool.
      //
      // Ownership is read off the run's OWN meta, the same way /portal/report/<runId> reads it, so a
      // foreign run is 404 and never 403: a run you may not read must be indistinguishable from one that
      // does not exist.
      if (parts[1] === "api" && parts[2] === "run" && parts[3] && parts[4] === "summary" && method === "GET") {
        assertPrincipal(principal, { door: true });   // door only — ownership is the meta check below
        const runId = parts[3];
        if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,180}$/.test(runId) || runId.includes(".."))
          return { status: 404, json: { error: "not_found" } };
        const dir = join(poolRoot, runId);
        let meta; try { meta = JSON.parse(readFileSync(join(dir, "meta.json"), "utf8")); } catch { return { status: 404, json: { error: "not_found" } }; }
        const owner = meta.customerKey || "generic";
        if (owner === "generic" && principal.role !== "staff") return { status: 404, json: { error: "not_found" } };
        try { assertPrincipal(principal, { account: owner }); } catch { return { status: 404, json: { error: "not_found" } }; }
        // ANSWERED FOR EVERY RUN THAT HAS ONE, grouped or not. A gate to grouped runs only stood here
        // and was wrong in the way this file keeps guarding against: a single-document run HAS this
        // prose — `report.md` is written on every run — so 404 would have said "there is none" about
        // something that exists, and `report.md` would have been a published file with no address on
        // exactly the runs where it is a duplicate rather than the original.
        //
        // The rule it was reaching for is real and belongs on the client: never print the same
        // paragraph twice on one screen. A single-document run's assessment is already rendered inside
        // the document the screen frames, so the screen does not ask (`showsAssessment` in
        // portal-ui/src/contract/reads.ts). Which view shows what is the screen's question; whether the
        // run has a summary is this one's.
        const summary = batchSummaryOf(dir);
        // AN ABSENCE, ANSWERED AS ONE. A run whose summary was composed empty has no paragraph, and a
        // 200 carrying [] would have the client render an empty panel that says nothing and explains
        // nothing. 404 means there is none, which the screen renders as no panel at all.
        if (!summary.length) return { status: 404, json: { error: "not_found" } };
        return { status: 200, json: { runId, summary } };
      }

      // /portal/api/queue/<id>/cancel — drop a job that has not started. No spend has happened, so
      // there is nothing to account for and no row is left behind.
      if (parts[1] === "api" && parts[2] === "queue" && parts[3] && parts[4] === "cancel" && method === "POST") {
        const account = assertPrincipal(principal, { account: query.account ?? null });
        if (!account) return { status: 400, json: { error: "name an account (?account=)" } };
        const id = decodeURIComponent(parts[3]);
        const mine = scanAccountRuns({ poolRoot, workspaceRoot, account, queueDirs: queueDirs() }).find((r) => r.runId === id && r.state === "queued");
        if (!mine) return { status: 404, json: { error: "not_found" } };
        let r = null;
        try {
          r = await stopRun({ id, onBehalfOf: principal.email });   // — same lane, same reason
        } catch (e) {
          const detail = String(e?.message ?? e);
          audit({ event: "queue-cancel", by: principal.email, account, id, ok: false, error: detail });
          return { status: 502, json: { ok: false, unwired: /not wired|verb|scope/i.test(detail),
            error: principal.role === "staff" ? detail : "It could not be cancelled just now. Nothing has been charged." } };
        }
        audit({ event: "queue-cancel", by: principal.email, account, id, ok: Boolean(r?.ok), action: r?.action ?? null });
        // ALREADY-CLAIMED IS A RACE, NOT AN ERROR. The runner picked it up between the click and the
        // request. Say so plainly and let the caller re-read the list, where it is now a running card —
        // never dress a lost race as a failure, and never pre-emptively disable the control to avoid it.
        if (r && r.ok === false && r.action === "already-claimed")
          return { status: 409, json: { ok: false, action: "already-claimed", id,
            error: "It started just before this reached us. It is running now — stop it from the card." } };
        return { status: 200, json: { ok: true, id, action: r?.action ?? null } };
      }

      // /portal/api/queue/order — the order queued jobs are admitted in.
      //
      // Written straight to the shared order file rather than through the MCP: reordering spends
      // nothing and starts nothing, so putting it behind an ops verb would widen that token's authority
      // for no gain. The tenancy wall is the same one every other route uses — the caller's resolved
      // account — applied per id.
      if (parts[1] === "api" && parts[2] === "queue" && parts[3] === "order" && method === "POST") {
        const account = assertPrincipal(principal, { account: query.account ?? null });
        if (!account) return { status: 400, json: { error: "name an account (?account=)" } };
        const asked = Array.isArray(body?.order) ? body.order.filter((s) => typeof s === "string" && s) : null;
        if (!asked) return { status: 400, json: { error: "send { order: [id, …] }" } };
        // Only ids this caller actually holds, and only ones still queued. Anything else is dropped
        // SILENTLY rather than refused: a rejection that named the offending id would confirm that some
        // other tenant's job exists, which is the one thing every refusal here is shaped to avoid.
        const ownQueued = new Map(
          scanAccountRuns({ poolRoot, workspaceRoot, account, queueDirs: queueDirs() })
            .filter((r) => r.state === "queued")
            .map((r) => [r.runId, r]),
        );
        const wanted = asked.filter((id) => ownQueued.has(id));
        const applied = reorderQueue({ workspaceRoot, order: wanted, allowed: new Set(ownQueued.keys()) });
        audit({ event: "queue-order", by: principal.email, account, ids: wanted.length, lanes: applied.lanes });
        return { status: 200, json: { ok: true, order: wanted, lanes: applied.lanes } };
      }
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

      // /portal/api/usage — what this account has used against its allowance.
      //
      // Its own route rather than a field on /portal/api/me, because it is per-ACCOUNT and `me` is
      // per-identity: a staff member acting for three clients has three different answers, and one of
      // them is never "yours". Cheap enough to fetch beside the composer and the run list.
      if (parts[1] === "api" && parts[2] === "usage" && method === "GET") {
        const account = assertPrincipal(principal, { account: query.account ?? null });
        if (!account) return { status: 400, json: { error: "name an account (?account=) — staff must pick who they act for" } };
        // Caps live on the customer profile and are code-owned (never client-editable). A deployment
        // with no config surface still answers, with counts and no caps — "we cannot tell you your
        // limit" is a better answer than a fabricated one.
        let caps = null, capsRead = false;
        if (upstream) {
          try {
            const r = await upstream.getProfile(principal, account);
            if (r.status === 200) { caps = r.json?.readOnly?.runCaps ?? null; capsRead = true; }
          } catch { /* a settings surface fault must not take the counter down */ }
        }
        // `complete` rides out with the counts (see usage-ledger.mjs): false means no ledger was read and
        // these numbers are a floor. The UI can render that as "—" the way it already renders an
        // unreadable cap as null, instead of a confident 0 nobody counted.
        //
        // `basis` is dropped here on purpose. What a client is owed is "we could not count", which
        // `complete` says; WHICH kind of nothing it was is an operator's diagnosis of our deployment and
        // belongs in the audit trail, where the quota pre-check puts it.
        const { basis: _basis, ...used } = accountUsage({ queueDirs: queueDirs(), account });
        return { status: 200, json: { account, ...used,
          // The EFFECTIVE daily allowance: the profile's value, else the default the wall applies — a
          // client reading "—" while the wall enforces 2 is the same lie as a wrong count. But a profile
          // we could NOT read still reports null: "we cannot tell you your limit" is a different
          // statement from "your limit is 2", and only one of them is honest when settings are down.
          dailyRuns: Number.isInteger(caps?.dailyRuns) ? caps.dailyRuns : (capsRead ? DEFAULT_CLIENT_DAILY_RUNS : null),
          monthlyRuns: caps?.monthlyRuns ?? null, maxQueued: caps?.maxQueued ?? null,
          // Staff are not capped, and the UI needs to know that to avoid showing a client's allowance
          // to someone it does not bind. See checkRunCaps for why role is decided here and nowhere else.
          capped: principal.role === "client" } };
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
      if (parts[1] === "api" && parts[2] === "mcp-access" && method === "GET") {
        assertPrincipal(principal, { door: true });   // throws PortalDeny(403) for an unmapped identity
        const url = process.env.CLEAROTRON_CLIENT_MCP_URL || null;
        const keyUrl = process.env.CLEAROTRON_AGENT_MCP_URL || null;
        // ── THE ROUTE THAT NEEDS NO ADDRESS ──────────────────────────────────
        //
        // Both addresses above are null on a local install and always will be: there is no hosted door
        // to point at. The surfaces built on them then render nothing — correctly, by their own rule —
        // and the owner met that as a wall on his own first install, with the one route that DOES work
        // sitting unmentioned on his disk.
        //
        // STAFF ONLY, and that boundary is honest rather than a guess about deployment shape. The
        // command is a true fact about THIS INSTALL'S OWN DISK, useful to anyone with a shell on the
        // box and useless to a hosted client who has no checkout. On a local install the reader IS the
        // operator, which is why the split that already exists does the work an "is this deployment
        // local" inference would have done badly. Agreed with overwatch before building, because it
        // changes what a signed-in staff user is shown.
        //
        // COMPOSED IN ONE PLACE and handed over as a string. The browser cannot know this install's
        // path, so the three surfaces stating this route cannot drift apart even if someone tries.
        const stdio = principal.role === "staff"
          ? stdioConnectOffer({ workDir: process.env.CLEAROTRON_WORK_DIR || null })
          : null;

        // ── THE PAGE IS HANDED ANSWERS, NOT FACTS TO REASON FROM ─────────────
        //
        // The browser used to hold its own client table on its own axis — `door` × `reach` — and derive
        // offered-versus-withheld from `url`, `keyUrl` and `enabled`. Two tables partitioning the same
        // clients on different axes did not merely risk drifting; they had already drifted. The page
        // said Codex needs a key address, which is `null` on a local install, so it named a one-line
        // command in its own instructions and then rendered no command. That is this issue's defect,
        // living inside the page written to answer it.
        //
        // So the resolution happens HERE, once, through `shared/connect-clients.mjs`, and the page
        // renders what it is handed. This is not a preference for server-side logic: the install's own
        // filesystem path is not a browser fact, and any derivation needing it must happen where it is
        // known. `assistantsFor` and `addressFor` are DELETED rather than kept in step, because a
        // second author kept in step by hand is exactly what broke.
        //
        // STAFF-ONLY STDIO SURVIVES THE MOVE. The command is a true fact about this install's own disk
        // — useful to anyone with a shell on the box, useless to a hosted client who has no checkout —
        // so a client is handed no stdio routes at all and the rows that need one resolve to a stated
        // absence rather than to a command they cannot run.
        const offers = connectOffers({
          stdioRoutes: stdio
            ? Object.fromEntries(Object.keys(STDIO_SHAPES).map((shape) =>
                [shape, stdioConnectFor(shape, { workDir: process.env.CLEAROTRON_WORK_DIR || null })]))
            : {},
          // ONE ADDRESS, and it is the publicly reachable one ( §5). The
          // `localAddress` and `clientDoorStanding` inputs are gone with the axis that read them: no
          // surface serves a loopback address to anybody, and the door's running-or-not stopped being
          // a question the moment it auto-started with the product.
          publicAddress: url,
          operator: principal.email ?? null,
        });
        return { status: 200, json: {
          url,                                   // null ⇒ the UI keeps its honest empty state
          keyUrl,                                // the API-key door; null until it is deployed
          email: principal.email ?? null,        // the identity to sign in with — what they already use
          enabled: !!url,
          stdio,                                 // the local route, or null for a client
          // Every client, already resolved: served or not, with what it needs or why it cannot be.
          //
          // ── `steps` COMES BACK, on the owner's 2026-09-03 ruling ─────────
          //
          // It was dropped here deliberately under his 2026-08-31 cut, which said the page shows no
          // recipes and the per-assistant blocks "become the one italic link at the bottom". His
          // re-inspection reverses that for one specific thing: *"The page must lead each vendor with
          // the path that vendor's UI user actually takes; a CLI command is at most a collapsed
          // 'advanced' detail."*
          //
          // The two rulings are consistent once you separate what was actually objected to. "Settings →
          // Connectors → Add custom connector" is not a recipe in the sense the cut banned — it is the
          // reader's OWN vocabulary, three taps in an app they already have open. The technical thing,
          // the one he called irrelevant to a Cowork user, is the command, and that is what moves behind
          // a fold. So the steps travel and the command demotes.
          //
          // They are resolved HERE and not composed in the browser, for the reason this route already
          // exists: the step that names an address must name the address this deployment actually
          // resolved, and a page that built its own would drift from it.
          offers: offersForWire(offers),
        } };
      }

      // /portal/api/connect-key — mint THIS caller's own access, for the clipboard, never for the page.
      //
      // ── THE OWNER'S RULING, 2026-08-31 ───────────────────────────────────────────────────────────
      //
      // *"The page never shows a key, in any state."* Three reasons he gave, and the second is the one
      // that shapes this endpoint: *"A rendered key outlives the moment. It's in the DOM, in the
      // screenshot someone takes, in the browser cache, on a screen left open. A key that's never text
      // on a page has none of that."*
      //
      // So the key still reaches the browser — a clipboard write needs it — and never becomes text. The
      // page holds it in a local variable for the length of one press.
      //
      // ── MINTED PER CALLER, AND `sub` NEVER COMES FROM THE REQUEST ────────────────────────────────
      //
      // The rule this replaces existed because a key shown on a shared page made one person's
      // credential everyone's. Moving it to the clipboard does NOT answer that on its own: anybody who
      // loads the page can still press the button. What answers it is that each press mints a key for
      // THE CALLER, from the authenticated principal and never from anything the request said — so a
      // colleague pressing it gets their own credential, attributable in the audit log and revocable by
      // name, rather than a copy of somebody else's.
      //
      // ENROLMENT IS CHECKED FIRST, for the same reason `clearotron connect` checks it: a key issued to
      // an identity the guest list has never heard of authenticates and is then refused on every
      // request, which is a credential that opens nothing and a reader who believes they are finished.
      if (parts[1] === "api" && parts[2] === "connect-key" && method === "POST") {
        assertPrincipal(principal, { door: true });
        const url = process.env.CLEAROTRON_CLIENT_MCP_URL || null;
        if (!url) return { status: 409, json: { error: "no_connector" } };
        const identity = principal.email ?? null;
        if (!identity) return { status: 403, json: { error: "no_identity" } };
        const granted = accountsForEmail(identity, loadGrants());
        if (Array.isArray(granted) && granted.length === 0) {
          return { status: 403, json: { error: "not_enrolled" } };
        }
        let key;
        try { key = mintToken({ scope: "account", sub: identity, ttlSec: 90 * 24 * 3600 }); }
        catch { return { status: 503, json: { error: "cannot_issue" } }; }
        auditLog(`connect-key issued for=${identity}`);   // WHO, never WHAT — the token itself is never logged
        return {
          status: 200,
          json: { address: url, key },
          // NEVER CACHED, by any hop. A credential sitting in a proxy or a disk cache is the "outlives
          // the moment" failure the ruling is about, arriving by a route the page cannot see.
          headers: { "cache-control": "no-store, no-cache, must-revalidate, private", "pragma": "no-cache" },
        };
      }

      // /portal/connect-help — the by-hand setup instructions, for the one link the page carries.
      //
      // ── WHY THIS ROUTE EXISTS AT ALL ─────────────────────────────────────
      //
      // The owner's cut ends the Use-your-AI page with *"Not connecting? [Set it up by hand](…)"* and
      // left the target open. There was no document route on this portal, so the link had nowhere to
      // go — and a link to nowhere is the same defect class as a button that cannot work. The
      // instructions already exist and carry exactly the recipes the cut removed from the page, so this
      // serves them rather than inventing a fourth description of how to connect.
      //
      // THE SIX BANNED WORDS DO NOT APPLY HERE, deliberately. "No connector, no key, no address" is a
      // rule about the PAGE, whose reader is choosing an assistant and nothing else. This is the escape
      // hatch for the reader who wants the mechanism, and withholding the vocabulary from them would
      // make the page's simplicity a lie rather than a kindness.
      //
      // READ-ONLY, DOOR-CHECKED, AND SERVED AS ESCAPED TEXT. It runs nothing and loads nothing, so it
      // gets `docCsp()` rather than the report policy, which permits inline script for frozen artefacts
      // that need it. Before this shipped the document named the private repository in an illustrative
      // path six times; nothing that reaches a client may carry that, so the placeholder now names the
      // install. Anything added to that file is published by this route — check it before you add it.
      if (parts[1] === "connect-help" && method === "GET") {
        assertPrincipal(principal, { door: true });
        let md;
        try { md = readFileSync(join(INSTALL_ROOT, "mcp-server", "CONNECT.md"), "utf8"); }
        catch { return { status: 404, json: { error: "not_found" } }; }
        return { status: 200, doc: md };
      }

      // /portal/api/runs
      if (parts[1] === "api" && parts[2] === "runs" && method === "GET") {
        // — THE VIEWER'S OWN DISMISSALS, stamped per request because the listing does not know who
        // is asking and must not learn: scanAccountRuns is shared with the staff index and the fold, and
        // a per-reader flag computed inside it would be one reader's preference baked into a cache every
        // other surface reads. So the scan answers "what is there" and this answers "what has THIS
        // reader put down". Every branch below goes through it — a route that stamped only the scope=mine
        // path would leave the same run acknowledged on one screen and not on another.
        const mine = (runs) => withAcks(runs, readAcks(poolRoot, principal?.email));
        // "All brand owners". STAFF ONLY, and it is a distinct code path rather than a wildcard passed
        // to assertPrincipal — a client must never reach a branch that skips the account resolution,
        // even by accident. A client who asks for it gets the same 404 as any account not theirs.
        if (query.account === "*") {
          // THE DOOR FIRST. This branch read `principal.role` directly, and `principal` is null for any
          // identity that is neither staff nor granted anything — the exact caller this route most needs
          // to refuse. Reading `.role` off null threw a TypeError, which is not a PortalDeny, so the
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
          if (principal.role !== "staff") return { status: 404, json: { error: "not_found" } };
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
          if (principal.role === "staff") {
            return { status: 200, json: { account: "*", runs: mine(forRole(scanAllRuns({ poolRoot, workspaceRoot, queueDirs: queueDirs() }), principal)) } };
          }
          // Resolved from `principal.accounts`, NEVER from the query — this is the same set
          // assertPrincipal hands back one key at a time, so it widens no boundary.
          //
          // `accounts === "*"` is the grants-file-absent posture (enforcement OFF). That is a
          // SENTINEL, NOT A LIST: expanding it here would turn a missing config file into a
          // cross-tenant read, so it falls through to the same refusal as holding nothing.
          if (Array.isArray(principal.accounts) && principal.accounts.length) {
            const own = principal.accounts.filter((a) => a !== "generic");   // the house account is staff-only, everywhere
            if (own.length) return { status: 200, json: { account: "*", runs: mine(forRole(scanAccountRuns({ poolRoot, workspaceRoot, account: own, queueDirs: queueDirs() }), principal)) } };
          }
          return { status: 404, json: { error: "not_found" } };
        }
        const account = assertPrincipal(principal, { account: query.account ?? null });
        if (!account) return { status: 400, json: { error: "name an account (?account=)" } };
        // untagged/generic runs are STAFF-only, matching the MCP face + the LEAK-#9 rule (a client
        // surface never lists generic — review 2026-07-18: the two boundaries disagreed)
        if (account === "generic" && principal.role !== "staff") return { status: 404, json: { error: "not_found" } };
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
      // /portal/report/<runId>/audit.xlsx — the audit workbook.
      //
      // MUST be branched before the report route below, which matches any parts.length >= 3 and would
      // otherwise answer this with the report's HTML under a spreadsheet's name.
      //
      // The comment this replaces said the portal "does not serve the file", and the embed strip removes
      // the report's own .xlsx link for that reason — so the workbook has been unreachable from the
      // portal since the portal existed. That was treated as a policy. It is not: the workbook is part of
      // the deliverable, and a link that is stripped without being replaced is a feature that quietly
      // stopped existing.
      //
      // The old objection — "a route serving archive files addressed by a path from the URL is the shape
      // of the bypass that leaked reports" — is answered by construction rather than by declining to
      // build it. The URL supplies ONE path segment, the run id, which is validated to be a directory
      // name and nothing else. The FILENAME is read from that run's meta.json. There is no component of
      // the served path a caller can influence, which is precisely what the report route already does.
      if (parts[1] === "report" && parts.length === 4 && parts[3] === "audit.xlsx" && method === "GET") {
        assertPrincipal(principal, { door: true });
        const runId = parts[2];
        if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,180}$/.test(runId) || runId.includes(".."))
          return { status: 404, json: { error: "not_found" } };
        const dir = join(poolRoot, runId);
        let meta; try { meta = JSON.parse(readFileSync(join(dir, "meta.json"), "utf8")); } catch { return { status: 404, json: { error: "not_found" } }; }
        const owner = meta.customerKey || "generic";
        if (owner === "generic" && principal.role !== "staff") return { status: 404, json: { error: "not_found" } };
        try { assertPrincipal(principal, { account: owner }); } catch { return { status: 404, json: { error: "not_found" } }; }
        // NOT staff-only any more. This route used to 404 a client on role alone — "the workbook is the
        // working paper behind the opinion, not the opinion" — with the note that widening it was a
        // disclosure decision and not one to make in passing. The owner made it on 2026-07-27, in the same
        // ruling that retired the two-report split: one report for everyone, and every reader who owns the
        // run may download its workbook. The ownership check two lines up is the boundary that matters and
        // it is unchanged — a client still sees exactly their own accounts' runs and 404s on anyone else's.
        //
        // (An audit's other half: the link we emailed pointed at the archive path, which the edge stopped
        // serving at the portal cutover, so no client had ever reached this gate to be refused by it. Both
        // ends are fixed together — auditUrlFor() in publish/index.mjs is the other one.)
        // (The held-run 404 that stood here is retired — one report, spec 2026-07-30 §5: ownership is
        // the boundary, and the workbook now carries the machine-QC row every owner may read.)
        // The name comes from the RUN, and is re-checked to be a plain basename even so: meta.json is a
        // generated file, and "generated by us" is not the same as "safe to concatenate into a path".
        const name = typeof meta.auditFile === "string" ? meta.auditFile : "";
        if (!/^[A-Za-z0-9][A-Za-z0-9._-]*\.xlsx$/.test(name)) return { status: 404, json: { error: "not_found" } };
        let bytes; try { bytes = readFileSync(join(dir, name)); } catch { return { status: 404, json: { error: "not_found" } }; }
        auditLog(`audit-download run=${runId} by=${principal.email}`);
        return { status: 200, file: {
          body: bytes,
          filename: name,
          contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        } };
      }
      // /portal/report/<runId>/… — ownership-checked client report; foreign = 404 (never 403)
      if (parts[1] === "report" && parts.length >= 3 && method === "GET") {
        assertPrincipal(principal, { door: true });   // door only — ownership is checked against the META below
        const runId = parts[2];
        // slug gate (review 2026-07-18: the old resolve-vs-resolve clause was a tautology): a runId is a
        // pool dir NAME — one path segment, no dots-only names, nothing traversal-shaped ever reaches fs
        if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,180}$/.test(runId) || runId.includes(".."))
          return { status: 404, json: { error: "not_found" } };
        const dir = join(poolRoot, runId);
        let meta; try { meta = JSON.parse(readFileSync(join(dir, "meta.json"), "utf8")); } catch { return { status: 404, json: { error: "not_found" } }; }
        const owner = meta.customerKey || "generic";
        if (owner === "generic" && principal.role !== "staff") return { status: 404, json: { error: "not_found" } };   // generic = staff-only (LEAK-#9 alignment)
        try { assertPrincipal(principal, { account: owner }); } catch { return { status: 404, json: { error: "not_found" } }; }   // foreign = 404, never 403
        // ONE REPORT PER MARK: `/portal/report/<runId>/` serves a run that has one document, and
        // `/portal/report/<runId>/<slug>/` serves one name's document out of a batch. A batch has no
        // run-level document at all — resolveReportFile returns null and this 404s — because serving mark
        // one of eight as "the report" is the defect the fan-out removed. report.client.html stays
        // retired (the cutover is done: clients.example.com serves through this same readReport
        // preparation). A run you have rights to is always served; the old held-run 404 is deleted with
        // the readiness state it enforced (spec 2026-07-30 §5 — the machine checks moved to the audit
        // workbook and decide nothing here).
        //
        // The slug is matched against the run's OWN list, never used to build a path: `meta.reports` is
        // the only source of a filename here, so a crafted segment can name nothing that is not already a
        // document this run published.
        const wantSlug = parts[3] && parts[3] !== "audit.xlsx" ? parts[3] : null;
        const reportFile = resolveReportFile(meta, wantSlug);
        if (!reportFile || !existsSync(join(dir, reportFile))) return { status: 404, json: { error: "not_found" } };
        // poolRoot is passed so the report's own stylesheet can be inlined: it is linked RELATIVE to the
        // archive (`../assets/chrome.css`) and 404s from under /portal/report/, which is what made every
        // report render with the wrong fonts and a 300px Swiss flag. See portal-report.mjs.
        // — NO FLAG CONTROL IS INJECTED, on this host or any other.
        //
        // `feedback` defaults OFF in prepareReportForEmbed, and this call site was the only opt-in in the
        // tree. Retiring the control is therefore the ABSENCE of an argument rather than a new one — which
        // is why nothing here reads a switch and nothing new was minted to hold one.
        //
        // The injection stays where it is (portal-report.mjs's FEEDBACK_CSS/FEEDBACK_JS, still exercised
        // by portal-report.test.mjs's `feedback: true` arms). The owner ruled disable, not delete, so
        // re-enabling the document half is this argument coming back.
        return { status: 200, html: readReport(dir, { log: auditLog, staff: principal.role === "staff", poolRoot, file: reportFile }) };
      }
      // POST /portal/api/feedback — a lawyer flags one finding on a delivered report.
      //
      // This is the SECOND POST under /portal/api that spends nothing (compose/read is the other). It
      // mints no confirmation token, queues nothing and changes no report: flagging is an observation
      // ABOUT a delivered artifact, never an instruction to the engine.
      //
      // THE RULE THAT MAKES A FLAG EVIDENCE: every identifying field is read SERVER-SIDE from the run's
      // own artifacts. The request supplies exactly three things — which run, which ordinal, and the
      // reader's own words. Mark, band, disposition, matter, account, engine build and the excerpt all
      // come from meta.json and report-data.json on disk. A client who could name the mark on a flag
      // could label another customer's finding with it, which is how the predecessor system's Triage
      // grouping was attacked (spec 61 critic finding 1) — and beyond the attack, a locator the reader
      // typed is a locator that cannot be trusted to still point anywhere.
      if (parts[1] === "api" && parts[2] === "feedback" && method === "POST") {
        assertPrincipal(principal, { door: true });
        // — RETIRED, 2026-08-20. It REFUSES; it does not disappear.
        //
        // AFTER assertPrincipal ON PURPOSE. A 410 says "this existed and is gone", which is exactly what
        // a reader on a report published before today needs to be told and exactly what an unauthenticated
        // prober should not learn. The door check runs first, so only a principal who could have used the
        // control sees the answer.
        //
        // 410 RATHER THAN 404, which is what every other refusal in this handler returns. The difference
        // is the audit log: `isAdminWrite` still names this path, so a POST here still files an outcome
        // row, and a retired-endpoint row is a different fact from a not-yours row. If an old open tab is
        // still clicking Flag, that is a thing worth being able to count.
        //
        // WHAT IS DELIBERATELY STILL BELOW THIS LINE: the whole resolver — 's two-lane shape, 's
        // disposition read, the server-side-locator rule. The owner ruled "disable services and any code",
        // and the acceptance criterion says re-enabling must be a switch and not a rebuild. Deleting 130
        // lines of hard-won doctrine would have made it a rebuild.
        if (!feedbackCapture) return { status: 410, json: { code: "retired", error: "Flagging a finding is switched off." } };
        const runId = typeof body?.runId === "string" ? body.runId : "";
        if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,180}$/.test(runId) || runId.includes(".."))
          return { status: 404, json: { error: "not_found" } };
        const dir = join(poolRoot, runId);
        let meta; try { meta = JSON.parse(readFileSync(join(dir, "meta.json"), "utf8")); } catch { return { status: 404, json: { error: "not_found" } }; }
        // Ownership, exactly as GET /portal/report/<id> checks it — foreign is 404, never 403, and
        // `generic` is staff-only. A reader who cannot READ the report cannot flag it either.
        const owner = meta.customerKey || "generic";
        if (owner === "generic" && principal.role !== "staff") return { status: 404, json: { error: "not_found" } };
        try { assertPrincipal(principal, { account: owner }); } catch { return { status: 404, json: { error: "not_found" } }; }

        const verdict = typeof body?.verdict === "string" ? body.verdict : "";
        if (!VERDICTS.has(verdict))
          return { status: 400, json: { code: "bad_verdict", error: "A flag is good or bad." } };
        const why = typeof body?.why === "string" ? body.why.trim() : "";
        if (!why) return { status: 400, json: { code: "why_required", error: "Say what is right or wrong about it — a flag with no reason cannot be acted on." } };
        if (why.length > MAX_WHY) return { status: 400, json: { code: "why_too_long", error: `That is longer than a note — keep it under ${MAX_WHY} characters.` } };

        // The ordinal names a POSITION; the finding's own facts are read back from the run so the flag
        // survives the contiguous renumber every republish performs.
        //
        // — THE TWO LANES SHAPE report-data.json DIFFERENTLY, and the resolver used to know one.
        //
        // Clearance writes a top-level `findings[]` numbered once across the document. Knockout writes
        // `marks.findings`, and restarts the ordinals at 1 FOR EACH MARK, so every mark in a
        // batch has a finding 1. Reading `data.findings` on a knockout run therefore found nothing, and
        // a flag on the knockout lane resolved to no facts at all — silently, because a flag with an
        // unresolved ordinal is a legitimate state (a run published before report-data.json existed).
        //
        // Branching on the SHAPE ON DISK rather than on what the request sent is the load-bearing part.
        // If a knockout flag arrives with no markIndex, this resolves NOTHING rather than falling back
        // to an ordinal lookup that would silently attach a lawyer's correction to the FIRST mark's
        // finding of that number. The issue is explicit that the wrong mark is worse than no mark.
        const ordinal = Number.isInteger(body?.ordinal) && body.ordinal > 0 ? body.ordinal : null;
        const markIndex = Number.isInteger(body?.markIndex) && body.markIndex >= 0 ? body.markIndex : null;
        let found = null, searchedMark = null, foundLane = null, engineCommitOf = meta.engineCommit ?? null;
        try {
          const data = JSON.parse(readFileSync(join(dir, "report-data.json"), "utf8"));
          engineCommitOf = data.engineCommit ?? engineCommitOf;
          if (ordinal != null) {
            if (Array.isArray(data.findings)) {
              found = data.findings.find((f) => f.ordinal === ordinal) ?? null;
              if (found) foundLane = "clearance";
            } else if (Array.isArray(data.marks) && markIndex != null) {
              const m = data.marks[markIndex] ?? null;
              found = (m?.findings ?? []).find((f) => f.ordinal === ordinal) ?? null;
              if (found) { foundLane = "knockout"; searchedMark = m?.name ?? null; }
            }
          }
        } catch { /* a run published before report-data.json: the ordinal still locates, the facts do not */ }

        // — THE DISPOSITION COMES FROM findings.json, NOT FROM report-data.json.
        //
        // report-data.json is the CLIENT CUT by construction, and `disposition` is a placement key in the
        // engine's own spelling — it stopped being served there in the same commit as this read. That
        // deletion on its own would have started writing `null` into the locator of every flag captured
        // from that moment on, and a flag is already-minted evidence a revert cannot repair. So the source
        // moves rather than disappearing: publish copies the run's findings.json into the pool run dir
        // (publish/index.mjs copyRO, both the strict and the lenient parse), which satisfies the rule this
        // handler states above — every identifying field read SERVER-SIDE from the run's own artifacts.
        //
        // JOINED ON ORDINAL **AND** MARK, and it resolves NOTHING on a mismatch. report-data projects the
        // same parsed findings array publish read from that same findings.json, so the ordinals are one
        // set — but a wrong disposition on a lawyer's flag is worse than no disposition ('s ruling on
        // the batch lane, applied here), so the mark is checked rather than assumed.
        //
        // CLEARANCE ONLY, on purpose. publish/knockout.mjs emits no disposition, so `found?.disposition`
        // was already null on that lane and this must not invent one from a differently-shaped file.
        //
        // ABSENT IS NULL, NEVER AN ERROR. A run with no findings.json (no register, or a top-level parse
        // failure that published a structured-light report) resolves to null — the same honest "the
        // ordinal locates, this fact does not" state a pre-report-data run records — and the flag still
        // saves. The audit line below records whether it resolved, so the absence is visible rather than
        // silent.
        let disposition = null;
        if (foundLane === "clearance") {
          try {
            const fj = JSON.parse(readFileSync(join(dir, "findings.json"), "utf8"));
            const rec = (Array.isArray(fj?.findings) ? fj.findings : []).find((f) => f?.ordinal === ordinal) ?? null;
            if (rec && String(rec.mark ?? "") === String(found.mark ?? "")) disposition = rec.disposition ?? null;
          } catch { /* no findings.json in the run dir: the finding still locates, its posture does not */ }
        }

        let rec;
        try {
          rec = appendFlag(feedbackDir(poolRoot), {
            runId, verdict, why,
            capturedBy: principal.email ?? null,
            locator: {
              ordinal,
              // — the drill-through key the report page and the workbook both print
              // (`<MARK> #<ordinal>`,), read off the resolved finding rather than composed here or
              // taken from the request. It is what a human reading the flag store or a minted issue
              // needs in order to find the row again, and on a batch it is the only thing that says
              // WHICH mark. Null on the clearance lane, which has no such key.
              ref: found?.ref ?? null,
              // The searched mark on the knockout lane, where `mark` below is the CONFLICTING name.
              searchedMark,
              // Clearance calls the conflicting name `mark`; the knockout view calls it `name`.
              mark: found?.mark ?? found?.name ?? null,
              band: found?.band ?? null,
              // — read above, from findings.json. NOT `found.disposition`: report-data.json no
              // longer serves the placement key, and a `?? null` fallback onto it would read as working.
              disposition,
              section: typeof body?.section === "string" ? body.section.slice(0, 120) : null,
            },
            // The sentence the reader was looking at, from the RUN rather than the request — the same
            // reason as the locator, and it keeps from putting attacker-authored prose in an issue.
            excerpt: found ? (found.net ?? found.impact ?? null) : null,
            run: {
              account: owner, matter: meta.matter ?? null, markName: meta.markName ?? null,
              product: meta.searchLevel ?? null, issuedAt: meta.issuedAt ?? null,
              engineCommit: engineCommitOf, runDir: dir,
            },
          });
        } catch (e) {
          audit({ event: "report-feedback", by: principal.email, runId, ok: false, error: String(e?.message ?? e) });
          return { status: 500, json: { code: "not_saved", error: "The flag was not saved. Nothing was lost from the report — try again." } };
        }
        // Length and location, never the words. A why is the lawyer's own reading of a client matter,
        // and an audit log is a different disclosure surface from the flag store.
        //
        // — `dispositionResolved` rides here because the disposition now comes from a SECOND file:
        // a clearance flag that located its finding but read no posture means findings.json was absent or
        // did not agree, and a null that nobody can see is how the paired edit would have failed silently.
        // Only on the lane that can carry one, so a knockout flag's honest null is not logged as a miss.
        audit({
          event: "report-feedback", by: principal.email, runId, account: owner, verdict, ordinal, markIndex,
          resolved: Boolean(found), ...(foundLane === "clearance" ? { dispositionResolved: Boolean(disposition) } : {}),
          chars: why.length, id: rec.id, ok: true, status: 201,
        });
        return { status: 201, json: { id: rec.id } };
      }
      // /portal/admin/* — staff-only surfaces (clients get 404: the surface does not exist for them)
      if (parts[1] === "admin") {
        assertPrincipal(principal, { staffOnly: true });
        if (parts[2] === "roster" && method === "GET") {
          const profiles = await loadProfilesImpl();
          // `generic` IS in the roster — this route is staff-only (asserted above), and untagged runs
          // are real work that staff have to be able to select. Excluding it made those runs reachable
          // by typing ?account=generic but invisible in the switcher, which is how they stop being
          // looked at. The client-facing boundary is unchanged: /portal/api/runs and the report route
          // both 404 `generic` for a non-staff principal.
          return { status: 200, json: { customers: [...profiles.values()].map((p) => ({ key: p.key, name: p.name })) } };
        }
        // /portal/admin/config — what this deployment actually has switched on. Read from the SNAPSHOT,
        // never from process.env: this process has no engine environment, so asking its own env would
        // report every switch as off on a box where they are on — and this page, of all pages, would be
        // believed.
        if (parts[2] === "config" && method === "GET") {
          // THE AUTH ROW IS READ LIVE, HERE, and not from the snapshot (, ruled 2026-08-21).
          // Everything else on this page comes from the snapshot because this process has no engine
          // environment. The portal's OWN door is the opposite case: this process reads
          // PORTAL_AUTH_MODE and acts on it a few hundred lines below, so it is the authoritative
          // source, and publishing it through a file another process writes would report a guess that
          // can go stale. Fed from process.env at the seam rather than inside authView, so the one
          // process entitled to answer is visibly the one reading.
          return {
            status: 200,
            json: {
              ...flagView(poolRoot),
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
        // family name is staff shorthand for a brand line — "Hydra range" can name a launch a client has
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
                const meta = JSON.parse(readFileSync(join(poolRoot, runId, "meta.json"), "utf8"));
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
          const { loadProfiles } = await import("./profiles.mjs");
          const knownAccounts = [...loadProfiles({ force: true }).keys()];
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
          return { status: 200, json: accessView({ grants: grantsNow(), staffDomains, knownAccounts, grantsFile }) };
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
      // GET /portal and every client-routed path below it are served by portal-static.mjs, ABOVE the
      // rate limiter and before this router ever sees them. Reaching here means a path the SPA handler
      // deliberately declined (an unknown /portal/api/* or /portal/report/* shape), which is a 404.
      return { status: 404, json: { error: "not_found" } };
    } catch (e) {
      if (e instanceof PortalDeny) return { status: e.status, json: { error: e.status === 404 ? "not_found" : e.message } };
      throw e;
    }
  }

  // ── — EVERY ADMIN WRITE FILES ITS OUTCOME, NOT ONLY ITS SUCCESS ──────────────────────────────
  //
  // Wrapped around route rather than added at each refusal site, because a call site demonstrably gets
  // forgotten — this issue is the evidence, filed against three writes that each remembered the success
  // line and none of the refusals.
  //
  // SCOPED TO THE ADMIN WRITE PATHS, which is the issue's binding Out of scope: "Per-request access
  // logging for the whole portal … This is about the admin WRITE paths, which are few, staff-only and
  // already have a sink." The first cut of this change wrapped EVERY route and filed a row for every
  // non-2xx anywhere — a client's 404 on /portal/api/runs, a malformed query on /portal/report/* — and
  // that is per-request access logging with a narrower name. isAdminWrite is the whole difference.
  //
  // It also costs something real. /portal/admin/observed reads this log back through a fixed 256 KiB
  // tail, so every row a poll files is span that panel can no longer see. The signal this issue wants
  // ("who tried and was refused") is worth that; a 404 on a static asset is not.
  //
  // FAILURES ONLY. The three write routes already file a richer row on success — the account, the
  // actor, the run count, which a generic row cannot know — so an unconditional row would duplicate
  // every one of them.
  //
  // A THROW IS NOT A REFUSAL, so it gets its own event. route() converts PortalDeny to a status and
  // rethrows everything else — anything arriving here is a bug on its way to becoming a 500, and it is
  // the outcome most worth having a line for. Scoped the same way: a crash in a read is the log's
  // business only if the log is a request log, which this one is not.
  async function routeAudited(method, path, identity, body = {}, query = {}) {
    const audited = isAdminWrite(method, path);
    let r;
    try {
      r = await route(method, path, identity, body, query);
    } catch (e) {
      if (audited) {
        audit(outcomeRow({ event: "request-error", method, path, email: identity?.email, status: 500,
          reason: e?.message ?? String(e) }));
        // A frozen or primitive throw cannot be stamped; a duplicate row beats swallowing the throw.
        try { if (e && typeof e === "object") e[AUDITED] = true; } catch { /* see above */ }
      }
      throw e;
    }
    if (audited && Number.isInteger(r?.status) && r.status >= 400)
      audit(outcomeRow({ method, path, email: identity?.email, status: r.status, reason: r.json?.error }));
    return r;
  }

  // `audit` LEAVES WITH `route`, and that is half the fix rather than a convenience.
  //
  // The bug report's own repro — an unauthenticated POST to /portal/admin/retired, answered 401, journal
  // unchanged — never reaches route() at all: makeHttpHandler resolves identity first and throws before
  // it calls this service. The sink is a closure parameter, so that function had no way to reach it and
  // no amount of wrapping route() would have closed the case the issue was filed about. Returning it is
  // what lets the door journal its own refusals into the same log, in the same shape.
  return { route: routeAudited, audit };
}

// The POC one-page UI that used to live here is gone. It built its rows with innerHTML string
// concatenation from upstream values — mark names, `meta.title`, `meta.matter`, recipe labels, stage
// labels, warnings — none of them escaped. Any of those is attacker-influenced: a mark name is typed by
// a user and a recipe label is stored config.
//
// It is not replaced by an escaped version. React escapes by default and `react/no-danger` is an error,
// so the whole class closes structurally rather than one sink at a time. The bundle is served by
// driver/portal-static.mjs.

/**
 * What the ops token this instance was handed actually CLAIMS. DECODED, NOT VERIFIED.
 *
 * This exists because a comment in this file used to assert a control that was not there. It described
 * the trigger lane as running on an "ACCOUNTS-SCOPED ops token — the confused-deputy blast radius is the
 * granted accounts", and the token deployed against it carries no `accounts` claim at all. shared/scope.mjs
 * authorize() only caps start_run `if (Array.isArray(scope?.accounts))`, and resolveScope defaults a
 * missing claim to accounts:"*" as first-party trust — so the described cap was never applied. A comment
 * asserting a wall that is not built is worse than no comment: it is the reason nobody goes to look.
 *
 * CORRECTED 2026-08-31, and the correction is this paragraph's own subject. This
 * used to read "the portal cannot mint itself a capped token from here … this process deliberately holds
 * no engine/MCP secrets — issuance is one path on purpose". **That wall was not built.** `bin/start.mjs`
 * generates TRADEMARK_MCP_TOKEN_SECRET into `~/.env`; the portal unit loads `EnvironmentFile=%h/.env`;
 * and `childEnv` hands the same value to the portal child. This process has held the signing secret on
 * both start paths for as long as both have existed, and four lines above, this very comment warns that
 * "a comment asserting a wall that is not built is worse than no comment: it is the reason nobody goes
 * to look". Nobody went to look, for the same reason.
 *
 * The portal is now an issuance path ON PURPOSE — `/portal/api/connect-key`, owner ruling 2026-08-31 —
 * minting an account key for the CALLER and for nobody else. What it still cannot do is mint for another
 * identity: `sub` comes from the authenticated principal and never from the request. What it CAN also do
 * is read the credential it was
 * configured with and say out loud what that credential permits, which turns the claim from an assertion
 * in a comment into a line an operator sees at every boot.
 *
 * Decoded, not verified, and the distinction matters: verification needs the signing secret this process
 * does not have. That is fine for this purpose — the question is "what was I configured with", not "is
 * this caller who they say they are", and a forged claim here would only mislead the operator reading
 * their own boot log. The MCP face verifies for real, on every call, and its answer is the one that binds.
 * The claim-shape tests below (non-empty array of non-empty strings) are copied from verifyToken() so
 * this cannot report a cap the enforcing side will discard.
 *
 * The cap was applied on 2026-07-20 (mint with `--accounts <keys>`, redeploy PORTAL_OPS_TOKEN), so the
 * boot line now names the accounts rather than warning. This function does NOT hardcode that: it reads
 * whatever token the process was given and reports what it finds, because the posture is a property of
 * the deployment and a comment asserting it would be the exact thing this replaced.
 */
export function opsTokenPosture(token, { now = Date.now() } = {}) {
  const none = { readable: false, scope: null, sub: null, verbs: null, accounts: null, accountCapped: false,
    expiresAt: null, daysLeft: null, expired: false, implausibleExp: false };
  const parts = String(token ?? "").split(".");
  if (parts.length !== 3 || parts[0] !== "v1" || !parts[1]) return none;
  let p;
  try { p = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")); } catch { return none; }
  if (!p || typeof p !== "object" || Array.isArray(p)) return none;
  const listOf = (v) => (Array.isArray(v) && v.length && v.every((s) => typeof s === "string" && s) ? v : null);
  const accounts = listOf(p.accounts);
  // The expiry is read for one reason: this credential is minted with a multi-month TTL and nothing
  // anywhere counts it down. When it lapses, every Start stops working — and the failure arrives as an
  // upstream refusal, which reads like an engine fault rather than an expired key card. A silent
  // deadline on the only credential in the spend path is worth surfacing at every boot.
  //
  // THE VALUE IS BOUNDED BEFORE IT IS FORMATTED, and that is not fussiness. `new Date(x).toISOString()`
  // throws RangeError beyond ±8.64e15 ms, this function is called from the BOOTSTRAP with no try/catch
  // around it, and its whole contract is decoding an UNVERIFIED, FORGEABLE payload. So an `exp` of
  // 1.79e15 — or a token minted in milliseconds by mistake — would stop the portal starting at all.
  // A credential whose expiry cannot be read must degrade to "unknown, and say so loudly"; it must
  // never be able to take down the service that reads it. Caught by adversarial review, after a first
  // pass that probed odd values but none large enough to leave the representable range.
  const EXP_MIN = 946_684_800;     // 2000-01-01 — before this, not a real issuance
  const EXP_MAX = 4_102_444_800;   // 2100-01-01 — after this, the units are wrong, not the date
  const rawExp = Number.isFinite(p.exp) ? p.exp : null;
  const expSec = rawExp !== null && rawExp >= EXP_MIN && rawExp <= EXP_MAX ? rawExp : null;
  const exp = expSec === null ? null : expSec * 1000;
  // Distinguishes "no exp claim" from "an exp claim that makes no sense". The second is a broken
  // credential and deserves a warning; the first is merely unknown.
  const implausibleExp = rawExp !== null && expSec === null;
  return {
    readable: true,
    scope: typeof p.scope === "string" ? p.scope : null,
    sub: typeof p.sub === "string" && p.sub ? p.sub : null,
    verbs: listOf(p.verbs),
    accounts,
    expiresAt: exp === null ? null : new Date(exp).toISOString(),
    daysLeft: exp === null ? null : Math.floor((exp - now) / 86_400_000),
    expired: exp === null ? false : exp <= now,
    implausibleExp,
    // The ONLY thing a caller should branch on. `null` accounts is not "no accounts" — it is "every
    // account", which is the inversion that made the old comment readable as reassuring.
    accountCapped: accounts !== null,
  };
}

// ──: WHICH DOCTRINE IS BEING SERVED, beside which engine is serving it ───────────────────────
//
// The engine's commit is cached for the life of the process and that is correct — engine-build.mjs
// says why: code cannot change under a running process without a restart. THE DOCTRINE STORE CAN. A
// config deploy re-renders the overlay in place and the portal keeps running, so a cached store sha
// would answer with the doctrine that was there when the process booted, which is precisely the
// stale-confirmation failure this whole endpoint exists to remove.
//
// So it is re-read, with a short TTL. The TTL is not a performance nicety — it is the bound on how
// wrong this field is allowed to be, and thirty seconds is short against a deploy cadence measured in
// hours. `classifySkillsStore` is the same function the run door calls, not a second copy of
// the git logic: two answers about one store that could drift apart would be worse than none.
//
// Best-effort, always. A health probe that 500s because git is slow has turned a diagnostic into an
// outage — the whole point is that it answers from any account, at any time, without a grant.
const STORE_TTL_MS = 30_000;
let storeCache = { at: 0, value: null };
function doctrineStore(now = Date.now) {
  const t = now();
  if (storeCache.value && t - storeCache.at < STORE_TTL_MS) return storeCache.value;
  let value;
  try {
    // `envFrom(process.env, …)` and NOT `config.skillsOverlayDir`, which is the same value: this
    // module must not import driver.config at module scope (see the queueDirs note above), and
    // driver.config.mjs's getter resolves the same name the same way — so this reads the source
    // rather than approximating it. The first draft here did reference `config`, which is not in scope
    // at module level; the ReferenceError landed in the catch below and came back as "unreadable",
    // which is exactly the kind of plausible wrong answer this endpoint exists to stop producing.
    const s = classifySkillsStore(envFrom(process.env, "CLEAROTRON_INSTRUCTIONS_DIR") || null,
      { mainBranch: process.env.CLEAROTRON_SKILLS_STORE_MAIN_BRANCH });
    value = { head: s.head ?? null, situation: s.situation, outcome: s.outcome };
  } catch (e) {
    // NOT `{head: null}` alone. A null head with no reason reads as "no store", which is a legal and
    // healthy state (`no-overlay`); this is a different thing and has to say so.
    value = { head: null, situation: "unreadable", outcome: "blocked", detail: String(e?.message ?? e).slice(0, 120) };
  }
  storeCache = { at: t, value };
  return value;
}

/** Test seam: forget the cached store answer. */
export function resetDoctrineStoreCache() { storeCache = { at: 0, value: null }; }

// ── HTTP plumbing + bootstrap (recipe-service pattern; html-aware send) ────────────────────────────
async function readJsonBody(req, limitBytes = 131072) {
  return await new Promise((resolve, reject) => {
    let len = 0; const chunks = [];
    req.on("data", (c) => { len += c.length; if (len > limitBytes) { reject(new Error("body_too_large")); req.destroy(); } else chunks.push(c); });
    req.on("end", () => { const s = Buffer.concat(chunks).toString("utf8").trim(); if (!s) return resolve({}); try { resolve(JSON.parse(s)); } catch { reject(new Error("body_unparseable")); } });
    req.on("error", reject);
  });
}


/**
 * The sign-in refusal page.
 *
 * A person refused at the door is the ONE case where a JSON body is actively harmful: they cannot read
 * it, cannot act on it, and — worst — cannot get out. Cloudflare Access holds the session, so the only
 * way to try a different address is its logout endpoint, and a raw error dump gives no route to it.
 * Someone signed in on the wrong account is then simply stuck, with a stack of technical text and no
 * door. That is what shipped, and it is why this exists.
 *
 * Deliberately self-contained: no bundle, no fonts, no network. This page has to render when the rest
 * of the portal will not.
 *
 * left this alone, deliberately. Its /cdn-cgi/access/logout button is Cloudflare's endpoint and
 * would be a 404 on a local install — but a local install never renders this page: an unauthenticated
 * BROWSER is redirected to /portal/login before any refusal is raised (see makeHttpHandler), and the
 * only callers that reach the AuthError branch below are the ones asking for JSON. Parameterising the
 * button would have been a branch nothing can take.
 */
export function denialPage(status, message) {
  const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  // The upstream message names the address and the reason. That is useful to the person reading it and
  // to whoever they forward it to — but it is a DIAGNOSTIC, so it sits below the fold of the sentence
  // that actually tells them what to do.
  const title = status === 403 ? "This address is not enrolled" : "You are not signed in";
  const body = status === 403
    ? `You reached ${BRAND.name}, but this address has not been given access to the portal. If you expected it to work, ask ${BRAND.name} to enrol it — or sign in with a different address.`
    : "Your session could not be verified. Signing in again usually fixes it.";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>${esc(title)} — ${esc(BRAND.name)}</title>
${FAVICON_LINK}
${FONT_LINK}
${DOOR_THEME_INIT}
<style>
  ${DOOR_ROOT}
  body { margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center;
         font:16px/1.55 var(--font); background:var(--cream); color:var(--ink); padding:24px; }
  .card { max-width:520px; background:var(--card); border:1px solid var(--line);
          border-radius:14px; padding:30px 32px; }
  .lockup { display:inline-flex; align-items:center; gap:10px; white-space:nowrap; margin-bottom:22px; }
  .mark { color:var(--ink); display:block; }
  .word { font-family:var(--mono); font-size:15px; font-weight:500; letter-spacing:.02em;
          line-height:1; color:var(--ink); }
  h1 { font-size:21px; margin:0 0 10px; font-weight:700; }
  p { margin:0 0 14px; color:var(--muted); }
  .row { display:flex; gap:10px; flex-wrap:wrap; margin-top:20px; }
  a.btn { display:inline-block; padding:9px 16px; border-radius:9px; text-decoration:none;
          border:1px solid var(--line-strong); color:var(--ink); font-size:14px; font-family:var(--font); }
  a.primary { background:var(--accent-fill); color:var(--accent-ink); border-color:var(--accent-fill); }
  code { display:block; margin-top:22px; padding:10px 12px; background:var(--code-bg);
         border-radius:8px; font:12px/1.5 var(--mono); color:var(--muted); word-break:break-all; }
  ${DOOR_ROOT_DARK}
</style></head><body><div class="card">
<span class="lockup"><span class="mark">${bracketMark(20, "currentColor", PALETTE.crimson)}</span><span class="word">${esc(BRAND.name.toLowerCase())}</span></span>
<h1>${esc(title)}</h1>
<p>${esc(body)}</p>
<div class="row">
  <a class="btn primary" href="/portal/sign-out">Sign in as someone else</a>
  <a class="btn" href="/portal">Try again</a>
</div>
<code>${esc(message)}</code>
</div></body></html>`;
}

// ──: THE LOCAL SIGN-IN DOOR ───────────────────────────────────────────────────────────────────
//
// SERVER-RENDERED, NOT A SPA SCREEN, and that is a hard constraint rather than a preference. CI greps
// the BUILT portal-ui bundle for `(CLEAROTRON|PORTAL|CF_ACCESS|MCP)_[A-Z_]+` and fails on a match, because
// no client-facing surface may name an internal switch. A login screen inside the SPA would want to
// explain which value to set when nobody is configured, and the first honest sentence it wrote would
// red the build. Here the same explanation is a line in the operator's terminal, where diagnostics
// belong, and the browser sees only what a person can act on.
//
// The page's own copy therefore NAMES NO VARIABLE. "The passphrase was printed in the terminal" is the
// whole of what a person needs; which file it was written to is the operator's business, and the
// operator is reading stderr.
//
// Self-contained for the same reason denialPage is: it has to render before the caller has an identity,
// which is exactly when the bundle may not be reachable.
const escHtml = (t) => String(t).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/**
 * loginPage({ email, error, signedIn }) — one field, because there is one user.
 *
 * The address is DISPLAYED, never asked for. Asking would invite the answer "which address works?",
 * which is a question this page must not be able to answer: a wrong passphrase and a wrong address get
 * the same sentence and the same status, so the form is not an oracle for either.
 */
// ── part 3 — THE LOGIN PAGE IS THE FACE OF THE PRODUCT ─────────────────────────────────────────
//
// This page hardcoded its own palette (`#f5f0e8`, `#fffdf9`, `#2c2a26`…), a system font stack, no mark
// and no wordmark, while `shared/brand.mjs` has exported all four for every other surface. It is the
// first thing a client sees and the only page they see before signing in.
//
// The lockup is the PROJECT lockup — bracket mark + wordmark — transcribed from the same rule
// `portal-ui/src/components/Logo.tsx` renders in React: mono family, weight 500, .02em tracking,
// nowrap, and NOT uppercased, because the brand string is lowercase deliberately and a text-transform
// would silently override it. The bracket geometry is not re-drawn here: `bracketMark()` is the one
// copy, and `driver/test/one-bracket-geometry.test.mjs` already binds it to portal-ui's.
//
// EVERY COLOUR ON THIS PAGE COMES FROM brand.mjs BY NAME, in BOTH schemes ( closed the half
// left open). The page declares no palette of its own: `DOOR_ROOT` and `DOOR_ROOT_DARK` are the door
// family's two blocks, shared with the refusal page above, and every value the dark scheme changes is a
// TOKEN — so there is no scoped override here that could restyle a selector the light block never
// mentioned. A colour literal reappearing in this function is what
// `driver/test/door-pages-take-their-colours-from-brand.test.mjs` fails on.
//
// The dark ground moved with that change: the block this page used to carry had guessed #17150f/#ece5d8,
// and brand pack §01 fixes dark at #0f0e0c near-black + #f0e8d8 parchment. The pack wins.
export function loginPage({ email, error = null, signedIn = false }) {
  const title = signedIn ? "Signed in" : "Sign in";
  const lockup = `<span class="lockup"><span class="mark">${bracketMark(20, "currentColor", PALETTE.crimson)}</span>`
    + `<span class="word">${escHtml(BRAND.name.toLowerCase())}</span></span>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>${escHtml(title)} — ${escHtml(BRAND.name)}</title>
${FAVICON_LINK}
${FONT_LINK}
${DOOR_THEME_INIT}
<style>
  ${DOOR_ROOT}
  body { margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center;
         font:16px/1.55 var(--font); background:var(--cream); color:var(--ink); padding:24px; }
  .card { max-width:420px; width:100%; background:var(--card); border:1px solid var(--line);
          border-radius:14px; padding:30px 32px; }
  .lockup { display:inline-flex; align-items:center; gap:10px; white-space:nowrap; margin-bottom:22px; }
  .mark { color:var(--ink); display:block; }
  .word { font-family:var(--mono); font-size:15px; font-weight:500; letter-spacing:.02em;
          line-height:1; color:var(--ink); }
  h1 { font-size:21px; margin:0 0 10px; font-weight:700; }
  p { margin:0 0 14px; color:var(--muted); }
  .who { font-weight:600; color:var(--ink); }
  a { color:var(--link); }
  label { display:block; font-size:13px; color:var(--muted); margin:18px 0 6px; }
  input { width:100%; box-sizing:border-box; padding:10px 12px; border:1px solid var(--line-strong);
          border-radius:9px; background:var(--card); color:var(--ink); font:15px/1.4 var(--mono); }
  button { margin-top:18px; padding:9px 16px; border-radius:9px; border:1px solid var(--accent-fill);
           background:var(--accent-fill); color:var(--accent-ink); font-size:14px; font-family:var(--font);
           font-weight:500; cursor:pointer; }
  .err { margin:16px 0 0; padding:10px 12px; border-radius:8px; background:var(--err-bg);
         border:1px solid var(--err-line); color:var(--err-ink); font-size:14px; }
  .hint { margin-top:18px; font-size:13px; }
  code { font-family:var(--mono); font-size:12.5px; background:var(--code-bg);
         padding:1px 5px; border-radius:4px; }
  ${DOOR_ROOT_DARK}
</style></head><body><div class="card">
${lockup}
<h1>${escHtml(title)}</h1>
${signedIn
    ? `<p>You are signed in as <span class="who">${escHtml(email)}</span>.</p>
<div><a href="/portal">Go to the portal</a></div>
<form method="post" action="/portal/logout"><button type="submit">Sign out</button></form>`
    : `<p>${escHtml(BRAND.name)} portal, as <span class="who">${escHtml(email)}</span>.</p>
${error ? `<p class="err">${escHtml(error)}</p>` : ""}
<form method="post" action="/portal/login">
  <label for="passphrase">Passphrase</label>
  <input id="passphrase" name="passphrase" type="password" autocomplete="current-password" autofocus>
  <button type="submit">Sign in</button>
</form>
<p class="hint">Lost the passphrase? Run <code>${escHtml(bareInvocation("passphrase"))} --reset</code> on the machine
running this portal. It mints a new one and prints it once.</p>`}
</div></body></html>`;
}
// The cookie the local session rides in. HttpOnly (no script needs it and nothing in the SPA reads it),
// SameSite=Strict (there is no cross-site flow to preserve — every portal navigation is same-origin),
// Path=/ so a report under /portal/report/… carries it too.
const SESSION_COOKIE = "portal_session";

/**
 * The first cookie parser in this file, and deliberately small: there is no dependency to add for one
 * name, and a general-purpose parser would be more code than the thing it parses.
 *
 * FIRST WINS on a duplicate name, which is what a browser sends for the most specific path and what
 * every server-side parser in wide use does. The alternative — last wins — is the shape cookie-shadowing
 * attacks are written against.
 *
 * The decode is guarded: `decodeURIComponent` throws on a malformed escape like `%zz`, and a cookie
 * header is attacker-controlled on any request. An unparseable value falls back to its raw text, which
 * then simply fails signature verification. A 500 on a bad cookie would be a way to take the portal's
 * error rate up from an unauthenticated socket.
 */
function parseCookies(header) {
  const out = Object.create(null);
  for (const part of String(header ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    if (!k || k in out) continue;
    const raw = part.slice(i + 1).trim();
    try { out[k] = decodeURIComponent(raw); } catch { out[k] = raw; }
  }
  return out;
}

/**
 * `Secure` ONLY when this request actually arrived over TLS.
 *
 * The failure this avoids is specific and total: a laptop user on http://127.0.0.1 handed a Secure
 * cookie gets a browser that stores it and never sends it back, so every sign-in succeeds and every
 * subsequent request is anonymous — a login loop with no error message anywhere.
 *
 * `x-forwarded-proto` is read even though it is a client-settable header, and that is safe HERE because
 * of the direction it can move the decision: a forged `https` can only ADD the attribute, i.e. make the
 * browser refuse to send its own cookie over plaintext. That is a self-inflicted denial, never an
 * escalation, and it is the only reading of a forwarded header that does not require trusting the peer.
 */
const requestIsTls = (req) => {
  if (req.socket?.encrypted) return true;
  const proto = String(req.headers?.["x-forwarded-proto"] ?? "").split(",")[0].trim().toLowerCase();
  return proto === "https";
};

const setSessionCookie = (token, { secure, maxAgeSec }) =>
  `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAgeSec}${secure ? "; Secure" : ""}`;
const clearSessionCookie = ({ secure }) =>
  `${SESSION_COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secure ? "; Secure" : ""}`;
/** A fixed destination, never one taken from the request — see the `redirect` note in the login branch. */
const redirectToLogin = (res) => {
  res.writeHead(302, { location: "/portal/login", "cache-control": "no-store", "content-length": 0 });
  return res.end();
};

/**
 * The refusal shape the outer catch already dispatches on: `name === "AuthError"` plus an integer
 * `status` (mcp-server/lib/cf-access.mjs). A local instance's "you are not signed in" must arrive at
 * the SAME door page and the SAME JSON body a Cloudflare refusal arrives at — one refusal, one
 * behaviour, whichever identity source is running.
 *
 * Declared here rather than imported from cf-access.mjs on purpose: that module statically imports
 * `jose`, and a laptop install has no reason to load a JWT library it will never call.
 */
class LocalAuthError extends Error {
  constructor(status, message) { super(message); this.name = "AuthError"; this.status = status; }
}

/**
 * The signed-in address carried by this request's cookie, or null.
 *
 * The check against the CONFIGURED address is deliberate and is the second wall. A session is only ever
 * minted for the one local user, so a valid signature naming somebody else means either the operator
 * changed who that user is, or the token came from another install that shares the secret. In both
 * cases the right answer is "sign in again", not "resolve this name through the roster and see what it
 * gets" — which is what accepting the token's own `sub` would do.
 */
function localSessionIdentity(req, localAuth) {
  const token = parseCookies(req.headers?.cookie)[SESSION_COOKIE];
  if (!token) return null;
  const s = verifySession({ token, secret: localAuth.secret });
  if (!s || s.email !== localAuth.email) return null;
  return { email: s.email };
}

/** The login form's body: url-encoded, small, and never JSON. 8 KiB is a passphrase with room to spare. */
async function readFormBody(req, limitBytes = 8192) {
  return await new Promise((resolve, reject) => {
    let len = 0; const chunks = [];
    req.on("data", (c) => { len += c.length; if (len > limitBytes) { reject(new Error("body_too_large")); req.destroy(); } else chunks.push(c); });
    req.on("end", () => resolve(new URLSearchParams(Buffer.concat(chunks).toString("utf8"))));
    req.on("error", reject);
  });
}

export function makeHttpHandler({ verify, limiter, service, log = () => {}, devIdentity = null, localAuth = null, static: staticHandler = null,
  // item 1 — PASSED IN, because this handler is its own function and the bootstrap that reads
  // the environment is another. The default is the Cloudflare Access header, so a caller that does
  // not pass one behaves exactly as before. Already lowercased by the caller; lowercased again here
  // because a default is not a promise about what a future caller hands over.
  authHeader = "cf-access-jwt-assertion" }) {
  const AUTH_HEADER = String(authHeader || "cf-access-jwt-assertion").trim().toLowerCase();
  // — A HANDLER WITH NO IDENTITY SOURCE REFUSES TO EXIST.
  //
  // This used to fall back to `{ email: "dev@local" }` when both `verify` and `devIdentity` were null,
  // which meant a construction mistake did not fail: it admitted every caller under one synthetic
  // address, and (with a grants row for it, or a staff domain matching its domain) served them real
  // customer data. Nothing threw, nothing logged, and the boot line said "AUTH OFF (dev)" on a service
  // nobody had asked to run in dev.
  //
  // Same posture and almost the same sentence as mcp-server/lib/http-handler.mjs, which has refused to
  // build an unauthenticated handler since it was written. `devIdentity` survives as a constructor
  // parameter because IN-PROCESS TESTS need to inject an identity without a socket or a JWT — that is
  // an explicit ask of — but it is now a thing a caller must PASS, never a thing it can get by
  // omission.
  if (!verify && !localAuth && !devIdentity)
    throw new Error("makeHttpHandler: an identity source is required — pass `verify` (the Cloudflare Access edge), `localAuth` (the local sign-in) or `devIdentity` (an injected identity, tests only). Refusing to build a handler that would admit every caller (fail-closed).");
  // `extra` exists so a response can carry a CSP. Before this the content-type was hardcoded and there
  // was no way to attach one — which is why the portal shipped without a policy rather than with a
  // permissive one.
  const send = (res, status, obj, extra = {}) => {
    const b = JSON.stringify(obj);
    res.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(b), ...extra });
    res.end(b);
  };
  return async function handler(req, res) {
    // — THE REFUSALS THIS FUNCTION DECIDES ITSELF, which until now were the silent ones.
    //
    // Identity is resolved HERE, before service.route() is ever called, so a request that fails the
    // door never reached the sink inside the service. That is the bug report's own measurement: an
    // unauthenticated POST to /portal/admin/retired answered 401 while the journal stayed at 300 lines.
    // The service hands its sink out with its router precisely so this door can file into the same log.
    //
    // PATHNAME ONLY. `req.url` carries the query string and this row must not; parsed defensively
    // because the outer catch can run before `url` was successfully built.
    const pathOnly = (u) => { try { return new URL(String(u ?? ""), "http://localhost").pathname; } catch { return ""; } };
    // SAME SCOPE AS THE ROUTER'S ('s Out of scope). Without this the door files a row for every
    // 302 to the login page and every rate-limited poll of /portal/api/runs — which is per-request
    // access logging arriving through the other entrance, and the first cut of this change did exactly
    // that. Computed once so a redirect and a 500 on the same request cannot disagree about it.
    const auditedPath = isAdminWrite(req.method, pathOnly(req.url));
    // `?.` — a service built by something other than makePortalService has no sink, and a journal that
    // is not there must never turn a 401 into a 500. Wrapped because the sink is best-effort by
    // contract (it appends to a file): the refusal is the answer, the row is the record of it.
    const journal = (status, reason, email = null) => {
      if (!auditedPath) return;
      try {
        service?.audit?.(outcomeRow({ method: req.method, path: pathOnly(req.url), status, email, reason }));
      } catch { /* best-effort, exactly like the sink itself */ }
    };
    // Hoisted out of the try so the 500 row below can name the actor. A crash on an admin write with no
    // "who" is a row that raises a question it cannot answer.
    let identity = null;
    try {
      const url = new URL(req.url, "http://localhost");
      if (req.method === "GET" && url.pathname === "/portal/health") {
        // — WHICH BUILD IS ANSWERING. Before this, confirming that a merge had reached test was
        // done by inference — merge ancestry plus the deploy timer's schedule — because no account
        // outside the pool's group could read a run's meta.json, and nothing served the commit. An
        // inferred deploy confirmation is the same shape as an unread absence: it is right until the
        // timer skips a beat, and nothing says which time you are looking at.
        //
        // `engineCommit()` is imported, not re-derived. It is the exact function publish/index.mjs
        // stamps into pool meta.json, so this endpoint and a new round's meta cannot disagree —
        // recomputing it here would build the drift the issue is about. Null off a git checkout, and
        // that is a real answer rather than a failure: a provenance stamp never breaks a health probe.
        //
        // ──: HOW OLD, WHICH LINE, AND WHICH BOX ──────────────────────────────────────────────
        //
        // The sha alone made every instance look alike. Production answering `ok:true` on a release 101
        // commits behind main is CORRECT — prod ships when the owner asks — and it reads identically to
        // a deploy that stopped. A reader had to already know to check ancestry, which is the check a
        // green tick talks people out of running.
        //
        // `engineCommitAt` is the number that cannot be misread, and it is deliberately NOT the
        // distance from `main` the issue suggested — see engine-build.mjs, where the measurement that
        // ruled that out is written down.
        //
        // `engineState` rides beside `engineBranch` because the branch alone collapses two states: a
        // pinned release runs detached and reports a null branch, and so does a probe that could not
        // reach git at all. Carrying the value without its discriminator is this repo's most expensive
        // recurring defect; `clean`/`dirty`/`blocked` is what separates them, and `dirty` additionally
        // catches the hand-patched checkout the deploy skill warns about.
        //
        // `box` is the EXISTING `CLEAROTRON_BOX` name (governance §5.1), not a new one — the deployment
        // already declares itself for `live-surface-check`'s unit inventory, and a second identity
        // would be a second thing to set and to get wrong. Imported rather than re-derived, and read
        // at request time rather than captured at module scope: portal-service sits outside
        // CLI_ENTRIES and applies the alias translation in its own body, so an import-time capture
        // freezes a pre-translation environment.
        //
        // Null when unset or unrecognised, which is an absence and reads as one. No inference from the
        // account or the path: a guessed box is worse than an unknown one, because it answers wrongly
        // instead of leaving the question open.
        return send(res, 200, {
          ok: true,
          ui: staticHandler ? (staticHandler.present() ? "built" : "missing") : "unwired",
          box: deploymentBox(),
          engineCommit: engineCommit(),
          engineCommitAt: engineCommitDate(),
          engineBranch: engineProvenance().engineBranch,
          engineState: engineProvenance().outcome,
          store: doctrineStore(),
        });
      }

      // ──: THE LOCAL SIGN-IN DOOR — before identity, because it is how identity is obtained ─────
      //
      // Mounted only when the local identity provider is running. On a Cloudflare-fronted instance
      // `localAuth` is null, these paths are answered by nothing here, and the edge is still the only
      // way in — this branch cannot become a second door on a deployment that did not ask for one.
      // ── THE FRONTED HALF OF THE SAME ROUTE ( — F47) ────────────────────────
      //
      // With no local provider the session belongs to Cloudflare Access and its endpoint is the only
      // thing that can end it, so this hands the browser there. Emitters link to ONE path in both modes
      // and none has to know which it is running in — three of them assumed fronted, which is the bug.
      //
      // WRITTEN INLINE, and that is not laziness. The `redirect` helper below is declared INSIDE the
      // local-auth block, so calling it from here threw ReferenceError and this route answered 500 —
      // worse than the dead link it replaced, because a dead link looks like a dead link and a 500
      // looks like the server broke. Found by `npm run lint:driver`, which says it in one line
      // (`'redirect' is not defined`), and by role-dev/Grogu driving the route rather than reading it.
      // Hoisting that helper would move it away from the comment explaining its own no-`?next=` rule,
      // so the four lines live here instead.
      if (!localAuth && url.pathname === "/portal/sign-out") {
        res.writeHead(302, { location: "/cdn-cgi/access/logout", "cache-control": "no-store", "content-length": 0 });
        return res.end();
      }

      if (localAuth && (url.pathname === "/portal/login" || url.pathname === "/portal/logout" || url.pathname === "/portal/sign-out")) {
        const secure = requestIsTls(req);
        const page = (status, body, extra = {}) => {
          res.writeHead(status, {
            "content-type": "text/html; charset=utf-8", "content-length": Buffer.byteLength(body),
            "cache-control": "no-store", "x-content-type-options": "nosniff", ...extra,
          });
          return res.end(body);
        };
        // NO `?next=` PARAMETER, ever. A post-login destination taken from the request is the
        // open-redirect class in its entirety, and there is exactly one place to land here.
        const redirect = (to, extra = {}) => {
          res.writeHead(302, { location: to, "cache-control": "no-store", "content-length": 0, ...extra });
          return res.end();
        };
        if (url.pathname === "/portal/login" && req.method === "GET")
          return page(200, loginPage({ email: localAuth.email, signedIn: !!localSessionIdentity(req, localAuth) }));
        if (url.pathname === "/portal/login" && req.method === "POST") {
          // Keyed on the peer address, counted by localAuth.attempts (portal-local-auth.mjs:
          // makeAttemptLimiter — a fixed window, NOT the 120/min token bucket the API routes share).
          // On a loopback install every attempt keys to 127.0.0.1, so the window is global; that is the
          // right answer for one user on one machine and is written down in the limiter's own comment.
          if (!localAuth.attempts.take(req.socket?.remoteAddress ?? "unknown"))
            return page(429, loginPage({ email: localAuth.email, error: "Too many attempts. Wait a few minutes and try again." }));
          let form;
          try { form = await readFormBody(req); } catch { return page(400, loginPage({ email: localAuth.email, error: "That passphrase is not correct." })); }
          let record;
          try {
            record = localAuth.credential();
          } catch (e) {
            // A credential file that has gone corrupt since boot. The operator gets the reason on
            // stderr; the browser gets a sentence with no filesystem in it.
            log(`local sign-in unavailable: ${String(e?.message ?? e)}`);
            return page(500, loginPage({ email: localAuth.email, error: "Sign-in is not available. The terminal that started the portal says why." }));
          }
          if (!record) log("local sign-in attempted but no credential is configured — stop the portal and start it again to mint one");
          // ONE SENTENCE FOR EVERY FAILURE. A wrong passphrase, an absent credential and an
          // unparseable form all answer "That passphrase is not correct." at 401: anything more
          // specific tells an unauthenticated caller which half of the credential they got right.
          if (!checkPassphrase(record, form.get("passphrase") ?? ""))
            return page(401, loginPage({ email: localAuth.email, error: "That passphrase is not correct." }));
          const token = mintSession({ email: localAuth.email, secret: localAuth.secret, ttlSec: localAuth.ttlSec });
          return redirect("/portal", { "set-cookie": setSessionCookie(token, { secure, maxAgeSec: localAuth.ttlSec }) });
        }
        if (url.pathname === "/portal/logout" && req.method === "POST")
          return redirect("/portal/login", { "set-cookie": clearSessionCookie({ secure }) });
        // ── SIGN-OUT, RESOLVED PER MODE, IN ONE PLACE ( — F47) ────────────
        //
        // Three emitters linked unconditionally to /cdn-cgi/access/logout — two screens and this
        // service's own error page. That is Cloudflare's endpoint and it is correct on a fronted
        // deployment; on LOCAL sign-in, which is what `clearotron start` gives every fresh install,
        // there is no Cloudflare and the browser got `{"error":"not_found"}` as a raw JSON blob. So on
        // every fresh install you could sign in and could not sign out — and on a shared or borrowed
        // machine ending your session is the one control a person expects to work.
        //
        // A GET, because the emitters are links a browser follows. It ends the LOCAL session, which is
        // the session that actually exists in this mode; the fronted branch below never reaches here.
        if (url.pathname === "/portal/sign-out")
          return redirect("/portal/login", { "set-cookie": clearSessionCookie({ secure }) });
        return send(res, 404, { error: "not_found" });
      }

      if (verify) {
        identity = await verify(req.headers[AUTH_HEADER]);
      } else if (localAuth) {
        identity = localSessionIdentity(req, localAuth);
        if (!identity) {
          // A BROWSER gets the door it can use; everything else gets the refusal it can parse. The same
          // Accept-based rule the AuthError branch below already applies, moved one step earlier so a
          // person who typed the address lands on the form rather than on a page ABOUT the form.
          // Journaled as well as the throw below: a browser is bounced to the form with a 302 and never
          // raises an AuthError, so this is the SAME refusal as the 401 and would otherwise be the one
          // shape of it that still left no line.
          if (String(req.headers.accept ?? "").includes("text/html")) {
            journal(302, "not signed in");
            return redirectToLogin(res);
          }
          // Identical in shape and status to what the CF edge throws for a missing JWT, so the SPA's
          // fetches and every API client see one refusal regardless of which door the instance runs.
          throw new LocalAuthError(401, "not signed in");
        }
      } else {
        identity = devIdentity;
      }

      // The SPA document and its assets are served here — after identity, BEFORE the limiter. They are
      // static, identical for everyone and cheap; the limiter exists to bound run triggering and status
      // polling. Sharing one 120/min budget between polling and page assets means a reload during an
      // active run can 429 a JS chunk, and a 429 on a chunk does not surface as an error — it surfaces
      // as a half-mounted app.
      if (staticHandler && staticHandler(req, res, url.pathname)) return;

      if (limiter && !limiter.take(identity.email)) {
        journal(429, "rate_limited", identity?.email);
        return send(res, 429, { error: "rate_limited" });
      }
      // A FIXED reason, not `e.message`. The parser's message is about the bytes it was given, and this
      // row must not become a place a caller can write into by sending a body that fails to parse.
      let body;
      try { body = await readJsonBody(req); }
      catch (e) { journal(400, "unreadable body", identity?.email); return send(res, 400, { error: String(e.message) }); }
      const query = Object.fromEntries(url.searchParams.entries());
      const r = await service.route(req.method, url.pathname, identity, body, query);
      // A PLAIN DOCUMENT this server renders itself. Escaped into a `<pre>`, so nothing in the file can
      // become markup — the document is a tracked repository file today, and "it is ours" is exactly the
      // assumption that makes an escaping bug permanent.
      if (r.doc != null) {
        const esc = String(r.doc).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
        const body = `<!doctype html><meta charset="utf-8"><title>Set it up by hand</title>`
          + `<style>body{margin:0;padding:28px;font:14px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace;`
          + `background:#fff;color:#111}pre{white-space:pre-wrap;word-wrap:break-word;margin:0}`
          + `@media(prefers-color-scheme:dark){body{background:#111;color:#eee}}</style><pre>${esc}</pre>`;
        res.writeHead(r.status, {
          "content-type": "text/html; charset=utf-8",
          "content-security-policy": docCsp(),
          "content-length": Buffer.byteLength(body),
          "x-content-type-options": "nosniff",
        });
        return res.end(body);
      }
      if (r.html != null) {
        // Reports only. A delivered report needs its own policy: `frame-ancestors 'self'` (the Result
        // screen embeds it) and inline script/style (the frozen renderer emits a self-contained file).
        // The SPA's stricter policy would make the browser refuse to frame it at all.
        res.writeHead(r.status, {
          "content-type": "text/html; charset=utf-8",
          "content-security-policy": reportCsp(),
          "x-content-type-options": "nosniff",
        });
        return res.end(r.html);
      }
      // A FILE. The audit workbook is the only one, and it needs a third response shape because the two
      // above are both text: JSON.stringify on a Buffer produces `{"type":"Buffer","data":[...]}`, which
      // downloads as a corrupt spreadsheet rather than failing loudly.
      //
      // `content-disposition: attachment` with a server-chosen filename, and nosniff, so nothing here is
      // ever rendered in the browser as a document — the name comes from the run's own metadata, never
      // from the request.
      if (r.file != null) {
        res.writeHead(r.status, {
          "content-type": r.file.contentType,
          "content-disposition": `attachment; filename="${r.file.filename.replace(/[^A-Za-z0-9._-]/g, "_")}"`,
          "content-length": r.file.body.length,
          "x-content-type-options": "nosniff",
        });
        return res.end(r.file.body);
      }
      // `r.headers` exists for ONE reason: a response carrying a credential must not be cached.
      // Without it the only way to say `no-store` was to add a fourth response shape.
      return send(res, r.status, r.json, r.headers ?? {});
    } catch (e) {
      if (e && e.name === "AuthError" && Number.isInteger(e.status)) {
        // THE ROW THE ISSUE WAS FILED ABOUT. Both doors throw this shape — the Cloudflare edge's verify
        // and the local sign-in's LocalAuthError — so one line here covers a refused write on either
        // deployment. Before the Accept split below, because a refusal is one event however it renders.
        // A FIXED VOCABULARY, NEVER `e.message` ('s third criterion: "a refusal must not become a
        // new disclosure surface"). This message comes out of `verify()` — the Cloudflare edge's JWT
        // check, a third-party library on some deployments — and nothing constrains what it puts in
        // there: a claim value, a subject, a fragment of the token it just rejected. The row is read
        // back by /portal/admin/observed, so free text from an auth library would be republished to
        // every member of staff. The status is the fact worth keeping and it is already a closed set.
        if (!alreadyFiled(e)) journal(e.status, DENIAL_REASON[e.status] ?? "refused at the door", identity?.email);
        // A BROWSER gets a page it can act on; an API client keeps the JSON it can parse. Deciding by
        // Accept rather than by path means the SPA's own fetches still see a clean error shape while the
        // person who typed the address gets a door.
        const wantsHtml = String(req.headers.accept ?? "").includes("text/html");
        if (wantsHtml) {
          const html = denialPage(e.status, e.message);
          res.writeHead(e.status, { "content-type": "text/html; charset=utf-8", "content-length": Buffer.byteLength(html), "x-content-type-options": "nosniff" });
          return res.end(html);
        }
        return send(res, e.status, { error: e.message });
      }
      log(`500 ${String(e?.message || e)}`);
      if (!alreadyFiled(e)) journal(500, e?.message ?? String(e), identity?.email);
      return send(res, 500, { error: "internal" });
    }
  };
}

const isMain = isEntrypoint(import.meta.url);
if (isMain) {
  // — TRANSLATE THE ENV NAMES BEFORE ANY VALUE IS READ, and this is NOT `env-local`.
  //
  // THE PRODUCTION EDGE THIS CLOSES: this service reads env names directly. INSTALL.md documents the
  // CLEAROTRON_* rename, so an operator who follows it renames the values in their unit and the portal
  // stops seeing ANY of them — and the mandatory-roster guard then refuses to start. Fail-closed,
  // correctly, on a machine that was configured correctly. Measured on the test box: the portal died on
  // exactly this. The reads this file OWNS now go through `envFrom`, which resolves either spelling on
  // its own; this pass stays because it covers the names read elsewhere, by modules this one calls.
  //
  // — AND THE CALL THAT USED TO SIT HERE FIXED THE FACT BUT NOT THE WHEN. It has moved to a
  // side-effecting `import "../shared/env-local.mjs"` at the TOP of this file. The reasoning it carried
  // is kept, because it was right about the ruling and wrong about only one thing:
  //
  //   It argued `applyEnvAliases` AND NOT `import "../shared/env-local.mjs"`, on the ground that
  //   "`env-local` READS `<repo>/.env`" and this service is deliberately off CLI_ENTRIES — "every value
  //   arrives named" — so a dotfile read would reverse that ruling.
  //
  // THE RULING IS RIGHT AND IS UNCHANGED. The premise is not: `env-local` reads `<repo>/.env` only when
  // `isCliEntry(process.argv[1])` says the running entry is on CLI_ENTRIES, while the
  // `applyEnvAliases()` at the bottom of that module is UNCONDITIONAL. This service is not on that list,
  // so importing it buys the translation and no dotfile. Measured, with the gate shown able to say yes:
  // a `.env` present and readable, `loaded → null`, `isCliEntry(driver/runner.mjs) → true`,
  // `isCliEntry(this entry) → false`, and the dotfile value never reaching a read.
  //
  // WHY THE POSITION MATTERED. A body call runs after every static import has already been evaluated,
  // and this service statically reaches `driver.config.mjs` (which captures `REGISTER_PROVIDER` at
  // module top) and `profiles.mjs` (which captures the store directory). On a host configured with the
  // new names only, both captures ran before the translation: `REGISTER_PROVIDER` was null — which makes
  // a run refuse by name — and the profile store fell back to the bundled default. The fact was fixed
  // and the ordering was not, so the same production edge described above stayed open.
  //
  // DO NOT PUT THIS SERVICE ON CLI_ENTRIES to "make the import consistent". That is the change the
  // paragraph above refuses, and env-local-does-not-read-a-dotfile-here.test.mjs fails if it happens.
  const HERE = dirname(fileURLToPath(import.meta.url));
  const log = (...a) => process.stderr.write(`[portal-service] ${a.join(" ")}\n`);
  // — resolved through the shared helper so the SOURCE travels with the number. "18802" and
// "18802 because nobody said otherwise" are different addresses to an operator, and only the
// second one is a guess at which instance this is.
const PORT_CHOICE = resolvePort({ value: process.env.PORTAL_SERVICE_PORT, name: "PORTAL_SERVICE_PORT", fallback: 18802 });
const PORT = PORT_CHOICE.port;
  const HOST = process.env.PORTAL_SERVICE_HOST || "127.0.0.1";
  // ──: THE IDENTITY SOURCE IS A MODE, AND IT IS NAMED, NOT INFERRED ─────────────────────────
  //
  // Two modes, both of which PROVE who the caller is:
  //
  //   cf-access (the default)  the Cloudflare Access edge — every hosted deployment, unchanged.
  //   local                    one address, one passphrase, a signed session cookie — one person on
  //                            one machine, which is the whole of what  asks for.
  //
  // There is no third mode and there is no longer a bypass. `PORTAL_AUTH_DISABLED` / `PORTAL_DEV` /
  // `PORTAL_DEV_EMAIL` are DELETED: they did not authenticate anybody, they skipped the question and
  // handed every caller one synthetic address, and they existed because there was no way for a single
  // person to log in. There is now.
  //
  // ── WHY LOCAL MODE MUST BE ASKED FOR BY NAME ─────────────────────────────────────────────────────
  //
  // The tempting rule is "no CF variables and a loopback host ⇒ local". It is rejected, on two measured
  // facts:
  //
  //   1. LOOPBACK DOES NOT DISCRIMINATE A LAPTOP FROM PRODUCTION. The test box and the production
  //      portal both bind 127.0.0.1 and are reached through a Cloudflare tunnel. `PORTAL_SERVICE_HOST`
  //      is unset on both, so it defaults to 127.0.0.1 on both. A rule keyed on loopback would be
  //      keyed on something every real deployment also satisfies.
  //   2. IT WOULD CONVERT A FAIL-CLOSED REFUSAL INTO A SILENT DOWNGRADE. Today a deployment that loses
  //      CF_ACCESS_TEAM or CLEAROTRON_OIDC_AUDIENCE REFUSES TO START and says so. Under the inferred rule the same
  //      accident starts a portal in local mode instead — reachable through the tunnel with a
  //      passphrase nobody has ever seen printed, and looking healthy. A missing value must never be
  //      able to choose a mode.
  //
  // So: unset means cf-access, exactly as before, including every fail-closed exit below. Local mode is
  // one explicit word, and an unrecognised word is fatal rather than quietly treated as the default.
  //
  // item 1 — `cf-access` NORMALISES TO `auth-proxy` HERE, at the read, and not as an alias row.
  // `shared/env-aliases.mjs` maps variable NAMES; `currentName`/`spellingsOf` are name-keyed and there is
  // no value-alias mechanism to reach for. The old word keeps working forever and means the same thing —
  // production deliberately leaves the variable unset, so no box changes on this rename.
  const AUTH_MODE_SET = (process.env.PORTAL_AUTH_MODE || "").trim().toLowerCase();
  const AUTH_MODE = AUTH_MODE_SET === "cf-access" ? "auth-proxy" : AUTH_MODE_SET;
  const LOCAL_MODE = AUTH_MODE === "local";
  const TEAM = process.env.CF_ACCESS_TEAM || "";
  // — F54. A deployment runs one Access application per audience; jose has
  // always accepted a list. `accessAudience` keeps a STRING for 0 or 1 so the `!AUD` guard below
  // stays fail-closed — an empty array would be truthy and open it.
  const AUD = accessAudience(envFrom(process.env, "CLEAROTRON_OIDC_AUDIENCE"));
  // item 1 — THE SAME FOUR VALUES THE STAFF MCP FACE ALREADY READS, under portal-side names
  // (mcp-server/http-server.mjs:92-95). `makeAccessVerifier` has always accepted them; the portal simply
  // never passed them, which is how one product shipped a provider-agnostic API face and a
  // Cloudflare-only web portal. Unset ⇒ the CF Access shapes derived from CF_ACCESS_TEAM, exactly as
  // before.
  const OIDC_ISSUER = process.env.PORTAL_OIDC_ISSUER || "";
  const JWKS_URL = process.env.PORTAL_JWKS_URL || "";
  const EMAIL_CLAIM = process.env.PORTAL_EMAIL_CLAIM || "email";
  // LOWERCASED, and this is load-bearing rather than tidy: Node lowercases incoming header names, so a
  // configured `Cf-Access-Jwt-Assertion` read verbatim yields `undefined` on every request and refuses
  // every correctly authenticated user — a blanket 401 with a valid token in hand. The MCP face already
  // does this (`:95`); a test covers it.
  const AUTH_HEADER = (process.env.PORTAL_AUTH_HEADER || "cf-access-jwt-assertion").trim().toLowerCase();
  // NO example.com default (review 2026-07-18 — the MCP face deliberately removed it: a forgotten env
  // silently denies every real identity at the edge while looking configured). Auth ON requires the
  // explicit domain list, which for THIS portal must include the CLIENT domains too (edge admission)
  // — enrolment is two-sided: the CF edge list AND the grants file (docs/PORTAL.md).
  const DOMAINS = (process.env.MCP_ALLOWED_EMAIL_DOMAINS || "").split(",").map((s) => s.trim()).filter(Boolean);
  // Individually named addresses, for people whose email domain cannot be admitted wholesale.
  const EMAILS = (process.env.MCP_ALLOWED_EMAILS || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  const LOOPBACK = new Set(["127.0.0.1", "::1", "localhost"]);

  let verify = null;
  const LOCAL_USER = (process.env.PORTAL_LOCAL_USER || "").trim().toLowerCase();
  if (LOCAL_MODE) {
    // Validated here, before anything else is read, so the mode's own mistakes are the first thing the
    // operator sees. The credential itself is established further down, AFTER the secret and the roster
    // guards — a boot that is going to refuse for a missing grants file must not write a passphrase
    // first and tell somebody to keep it.
    if (!LOCAL_USER) {
      log("FATAL: PORTAL_AUTH_MODE=local names no user — set PORTAL_LOCAL_USER to the one email address that signs in here, and enrol that same address in the grants file (" + "CLEAROTRON_ACCESS_FILE" + ") or on a staff domain (PORTAL_STAFF_DOMAINS). Refusing to start.");
      process.exit(1);
    }
    if (!LOCAL_USER.includes("@") || LOCAL_USER.indexOf("@") !== LOCAL_USER.lastIndexOf("@")) {
      log(`FATAL: PORTAL_LOCAL_USER="${LOCAL_USER}" is not a single email address — portal-access.mjs refuses a multi-@ identity outright, so this would sign in and then be denied at the door. Refusing to start.`);
      process.exit(1);
    }
    // LOOPBACK ONLY, and this one IS fatal rather than a warning. Local mode carries a passphrase in a
    // form POST and a session in a cookie; off loopback, without TLS, both are on the wire in clear, and
    // the cookie cannot even be marked Secure because the browser would then stop sending it. The
    // remedy is not a wider bind — it is to keep this on loopback and put a TLS-terminating proxy in
    // front of it, which is also what every Cloudflare-fronted instance already does.
    if (!LOOPBACK.has(HOST)) {
      log(`FATAL: PORTAL_AUTH_MODE=local with PORTAL_SERVICE_HOST=${HOST} would carry a passphrase and a session cookie over plaintext to another machine. Bind loopback and put a TLS-terminating proxy in front if it must be reachable. Refusing to start.`);
      process.exit(1);
    }
    log(`auth ON — local sign-in, one user (${LOCAL_USER}), loopback only`);
  } else if (AUTH_MODE && AUTH_MODE !== "auth-proxy") {
    // An unrecognised mode is FATAL, never a silent fall-through to the default. A typo
    // ("PORTAL_AUTH_MODE=Local " is fine — trimmed and lowercased above; "loca1" is not) must not be
    // able to select an identity source nobody chose.
    log(`FATAL: PORTAL_AUTH_MODE="${AUTH_MODE_SET}" is not a mode this service has. Use "local" (one passphrase, loopback) or "auth-proxy" (any login system in front that authenticates in the browser and forwards a verifiable JWT — Cloudflare Access is one instance of this, and "cf-access" is still accepted and means the same thing; also the default when unset). Refusing to start.`);
    process.exit(1);
  } else if ((!TEAM && !OIDC_ISSUER) || !AUD) {
    // item 1 — an audience, plus EITHER a Cloudflare team OR an issuer. A deployment with an Entra
    // issuer and no Cloudflare team could not start at all before this; missing BOTH is still fatal, and
    // that is the half that must not soften.
    log(`FATAL: auth enabled but CLEAROTRON_OIDC_AUDIENCE plus CF_ACCESS_TEAM or PORTAL_OIDC_ISSUER are missing — refusing to start (fail-closed).`); process.exit(1);
  } else if (!DOMAINS.length && !EMAILS.length) {
    log("FATAL: auth enabled but neither MCP_ALLOWED_EMAIL_DOMAINS nor MCP_ALLOWED_EMAILS is set — no default (fail-closed)."); process.exit(1);
  } else {
    const { makeAccessVerifier } = await import("../mcp-server/lib/cf-access.mjs");
    // BOTH gates, because this portal's population is two different shapes.
    //
    // Staff arrive on ONE corporate domain, so a domain rule is right for them. Clients arrive on
    // whatever address their business uses — and increasingly on consumer domains. Admitting a whole
    // consumer domain at the edge to enrol one person would put every gmail.com address on Earth
    // through the door, leaving the grants file as the only thing between them and a 403. That is one
    // wall where there should be two, so individual addresses are named instead.
    // UNION, not intersection. The default combines the two lists with AND — correct for narrowing
    // within one domain, and catastrophic here: staff would fail the email list while clients failed the
    // domain list, refusing everyone. That is not hypothetical; it happened in production and locked out
    // every identity including the one the domain rule exists for.
    verify = makeAccessVerifier({ team: TEAM, aud: AUD, allowedDomains: DOMAINS, allowedEmails: EMAILS, identityMode: "union",
      issuer: OIDC_ISSUER || undefined, jwksUrl: JWKS_URL || undefined, emailClaim: EMAIL_CLAIM });
    // THE BANNER NAMES THE HEADER AND THE CLAIM, because a mis-set header is otherwise indistinguishable
    // from a blanket 401 — the operator reads it here instead of discovering it as "nobody can log in".
    log(`auth ON — issuer=${OIDC_ISSUER || `CF Access team=${TEAM}`} aud=${audienceLabel(AUD)} claim=${EMAIL_CLAIM} header=${AUTH_HEADER} domains=[${DOMAINS.join(", ")}] emails=[${EMAILS.length}]`);
  }

  // — THE `dev-secret-not-for-prod` FALLBACK IS DELETED. A shipped default signing key is the
  // exact shape this issue exists to remove: it turned a missing required value into a working service
  // signing with a secret that is in the source tree, and the only thing standing between that and
  // production was one environment variable being read correctly. It is required in both modes now, and
  // it signs BOTH token families — the confirmation tokens (unprefixed) and, since, the local
  // session cookies (prefixed with `portal-session.v1|`; see portal-local-auth.mjs for why one secret
  // with a domain separator is preferred to two secrets).
  const secret = process.env.PORTAL_SECRET || "";
  if (!secret) { log("FATAL: PORTAL_SECRET is required (it signs the confirmation tokens and, in local mode, the session cookie) — refusing to start."); process.exit(1); }
  const { loadGrants } = await import("../shared/scope.mjs");
  // ── the roster is MANDATORY ────────────────────────────────────────────────────────────────────
  //
  // Mirrors the guard on the MCP face (mcp-server/http-server.mjs, the CLEAROTRON_ACCESS_FILE check in the
  // auth-disabled branch), for the same reason and with the same fail-closed posture — but WIDER, and
  // the difference is the point.
  //
  // shared/scope.mjs, first line of accountsForEmail: `if (!grants) return "*"`. With CLEAROTRON_ACCESS_FILE
  // unset, EVERY identity this portal admits resolves to accounts:"*". makePrincipal hands back
  // { role: "client", accounts: "*" } (portal-access.mjs — the "*" branch is honoured, only the ROLE
  // stays client), assertPrincipal then approves whatever ?account= is asked for, and one signed-in
  // customer reads every other customer's runs, held reports and configuration. Nothing throws, nothing
  // 403s, nothing appears in a log: it is a silent read-all across the whole book of business, and the
  // only outward sign is that the account picker offers names its owner has never heard of.
  //
  // UNCONDITIONAL, unlike the MCP's. There the guard sits inside the auth-disabled branch, because with
  // auth ON a caller has proven a firm email domain and read-all is what firm staff are supposed to
  // have. That reasoning does not transfer: this portal admits CLIENTS at the edge on purpose
  // (MCP_ALLOWED_EMAILS names individual customer addresses — see the DOMAINS/EMAILS union above), so
  // "auth is ON" says nothing whatever about whether the caller may see everything. In both modes the
  // grants file is the only thing that decides, so in both modes it is required.
  //
  // The check further down — `!staffDomains.length && !grants()` — does NOT cover this and never did.
  // It is satisfied by PORTAL_STAFF_DOMAINS alone, which is set on every real deployment, so it stays
  // green while the read-all is live. It answers "could anybody sign in?", not "is anybody bounded?".
  //
  // An empty roster is a legitimate answer: a file containing only {"tenants":{}} admits staff by domain
  // and grants no client anything, which is the correct starting state for a fresh instance. What is not
  // legitimate is having no file, because that is indistinguishable from "not configured yet" and means
  // the opposite of what it looks like.
  if (!envFrom(process.env, "CLEAROTRON_ACCESS_FILE")) {
    // — THE REFUSAL NAMES THE CURRENT SPELLING. The lookup is fine and that was verified rather
    // than assumed: `shared/env-local.mjs` runs `applyEnvAliases()` at module load, so a reader who set
    // the current name has it back-filled onto the retired key before this line runs. What was wrong is
    // that the refusal quoted the RETIRED name whichever one they set — sending an operator to a
    // variable they never touched, at the one moment the service refuses to start.
    log(`FATAL: CLEAROTRON_ACCESS_FILE is unset — refusing to start (fail-closed). Without it shared/scope.mjs accountsForEmail() returns "*" for every identity, so any admitted client reads EVERY customer's runs, reports and configuration, silently. Point it at a grants file, even one containing only {"tenants":{}}.`);
    process.exit(1);
  }
  // per-REQUEST loader (review 2026-07-18): enrolment lands without a restart; an unreadable grants
  // file at boot is FATAL, and one that turns unreadable later is a hard 500 per request (loadGrants
  // throws when set-but-unreadable), never a silent fallback.
  try { loadGrants({}); } catch (e) { log(`FATAL: grants file unreadable: ${e.message}`); process.exit(1); }
  const grants = () => loadGrants({});
  const staffDomains = (process.env.PORTAL_STAFF_DOMAINS || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!staffDomains.length && !grants()) { log(`FATAL: neither PORTAL_STAFF_DOMAINS nor CLEAROTRON_ACCESS_FILE configured — nobody could ever sign in (fail-closed).`); process.exit(1); }

  const { config } = await import("./driver.config.mjs");
  const { appendFileSync: append } = await import("node:fs");
  const auditPath = process.env.PORTAL_AUDIT || join(HERE, "..", "portal-audit.log");
  const audit = (rec) => { try { append(auditPath, JSON.stringify({ at: new Date().toISOString(), ...rec }) + "\n"); } catch { /* best-effort */ } };
  // — SAY WHERE THE RECORD IS, IN THE PLACE PEOPLE LOOK FOR IT.
  //
  // Every mutating admin request is already recorded: the route files its own row on success
  // (`run-retire`, `run-restore`, `family-group`, `trigger`, `stop`, …), `routeAudited` files one for
  // any 4xx, and the door files one for a refusal it decides itself. The gap the owner hit was
  // not that nothing was written — it was that all of it goes to THIS FILE, and the box's journal, which
  // is what an operator reads, never mentioned the file existed.
  //
  // So triage of "I clicked Retire and it errored" looked at 17 lines of startup banner and concluded
  // the request never arrived. 's own triage recorded that same absence as its central lead and
  // called it "the first thing to explain" — there was nothing to explain, and a second investigation
  // spent itself on the same non-signal.
  //
  // One line, at startup, naming the path. NOT a second per-request log into the journal: every one of
  // those rows would duplicate a row this file already has, and `/portal/admin/observed` reads this log
  // back through a fixed 256 KiB tail, so a duplicate is span that panel can no longer see.
  log(`audit log: ${auditPath} — every admin write, refusal and 500 lands here (PORTAL_AUDIT overrides). `
    + "The journal carries startup and fatals only; a save that a client reported as failed is answerable from that file, not from here.");

  // live trigger: the MCP HTTP face with an ops token (never a direct queue write). The face serves ONLY /mcp
  // (Streamable-HTTP JSON-RPC: initialize → tools/call — review 2026-07-18: the old bare-REST
  // /tools/start_run hit a route that exists nowhere), so this client speaks real MCP; the wire shape
  // is pinned by driver/test/portal-mcp-client.test.mjs, which drives the real client against a face
  // that enforces the real path contract.
  //
  // PORTAL_MCP_URL is an ORIGIN — "http://127.0.0.1:18790", NOT ".../mcp". The client appends /mcp
  // itself, so a value carrying it produces /mcp/mcp and 404s on the first press. Pinned by that test.
  const MCP_URL = process.env.PORTAL_MCP_URL || "";
  const OPS_TOKEN = process.env.PORTAL_OPS_TOKEN || "";
  // WHAT THE TRIGGER LANE IS ACTUALLY CAPPED TO — printed rather than assumed.
  //
  // History, because the shape of the mistake is worth keeping. This file's header once ASSERTED the
  // token was accounts-scoped while the deployed token carried no `accounts` claim at all — and
  // shared/scope.mjs treats an absent claim as accounts:"*" (resolveScope, first-party trust), so
  // authorize()'s start_run cap never engaged. The comment described a wall that did not exist.
  //
  // Both walls exist now (capped 2026-07-20): the principal check in route() stamps profileKey from the
  // VERIFIED account and a body cannot supply it, AND the token names the accounts it may start. What
  // stays true regardless is that NOTHING HERE ASSERTS IT — the posture is read from the live token on
  // every boot, so a deployment that loses the cap says so rather than inheriting this paragraph's word
  // for it.
  //
  // WARNING, not FATAL, and the line between them is deliberate. Every other refusal-to-start in this
  // bootstrap fires on a MISSING config value whose absence widens access at runtime (no grants file ⇒
  // read-all; no CLEAROTRON_OIDC_AUDIENCE ⇒ unverified identity). An uncapped token is not that shape: the
  // credential is present and the instance works, and refusing to boot over a defence-in-depth cap would
  // turn a degraded posture into an outage. Promoting it to fatal is defensible now that production is
  // capped; it is left as a warning until a second deployment has been through a full re-mint cycle,
  // because the failure it would cause lands on whoever forgets, at the worst moment.
  // ── THE LINE SAYS WHETHER THE LANE IS WIRED, NOT ONLY WHAT THE TOKEN IS ──────
  //
  // The owner submitted a clearance and got a 502 on a box where this line had been printing happily
  // for as long as the lane had been dead. It fired on OPS_TOKEN alone and described the token's
  // posture in detail, so a reader scanning the journal for "trigger lane" found a confident sentence
  // about a lane that could not carry a request — PORTAL_MCP_URL had never been set there, because
  // `clearotron start` is the only thing that derives it and that box launches its door directly.
  //
  // A LANE NEEDS BOTH HALVES, so the line names both and leads with the missing one. The token half is
  // still described exactly as before — it is genuinely useful and none of it was wrong. What was wrong
  // was printing it under a heading that implies the other half.
  const posture = opsTokenPosture(OPS_TOKEN);
  const laneWired = !!String(MCP_URL ?? "").trim() && !!OPS_TOKEN;
  if (!laneWired) {
    const missing = [!String(MCP_URL ?? "").trim() && "PORTAL_MCP_URL", !OPS_TOKEN && "PORTAL_OPS_TOKEN"].filter(Boolean);
    log(`trigger lane: NOT WIRED — ${missing.join(" and ")} unset. The portal starts and serves, its health `
      + "endpoint answers, and the Start button returns 502 because there is nothing behind it. "
      + "`clearotron start` derives PORTAL_MCP_URL from its resolved ports; a box that launches this "
      + "service directly must set it to the engine door's own ORIGIN (no /mcp — the client appends it).");
  }
  if (OPS_TOKEN) {
    const expiry = posture.expiresAt ? ` expires=${posture.expiresAt.slice(0, 10)} (${posture.daysLeft}d)` : " expires=UNKNOWN";
    // PREFIXED WHEN THE LANE IS DEAD, so this line cannot be read on its own as evidence of a working
    // lane — a journal is skimmed by grepping one phrase, and the phrase people grep is this one.
    log(`trigger lane${laneWired ? "" : " (NOT WIRED — see above)"}: ops token sub=${posture.sub ?? "-"} verbs=${posture.verbs?.join(",") ?? "(full ops)"} accounts=${posture.accounts?.join(",") ?? "UNCAPPED (every account)"}${expiry}${posture.readable ? "" : " — token payload unreadable, posture unknown"}`);
    if (!posture.accountCapped)
      log("WARNING: the trigger ops token carries no `accounts` claim, so it is NOT account-capped — the only thing bounding a trigger to one customer is this portal's own principal check. Re-mint with `mcp-server/mint-token.mjs --scope ops --sub portal --verbs start_run,stop_run --accounts <keys>` to make it two walls.");
    // The token is VERB-scoped, so a portal minted before Stop existed can start runs and cannot stop
    // them — and that refusal arrives from upstream looking like an engine fault. Name it here, at boot,
    // where it is one line in the journal instead of a mystery at the moment someone needs to stop a run.
    if (Array.isArray(posture.verbs) && !posture.verbs.includes("stop_run"))
      log(`WARNING: the ops token's verbs are [${posture.verbs.join(", ")}] — it CANNOT stop_run, so every Stop and every queued-job Cancel will fail as an upstream refusal. Re-mint with \`--verbs ${[...new Set([...posture.verbs, "stop_run"])].join(",")}\`.`);
    // The deadline nobody was counting. When this lapses every Start fails as an upstream refusal,
    // which reads as an engine fault; 21 days is enough notice to re-mint without hurrying.
    if (posture.implausibleExp)
      log("WARNING: the trigger ops token carries an `exp` outside any plausible range — it cannot be counted down, and the token may have been minted in the wrong units. Treat its expiry as unknown and re-mint.");
    else if (posture.expired)
      log(`WARNING: the trigger ops token EXPIRED on ${posture.expiresAt.slice(0, 10)} — starting a run will fail until it is re-minted.`);
    else if (posture.daysLeft !== null && posture.daysLeft <= 21)
      log(`WARNING: the trigger ops token expires in ${posture.daysLeft} day(s) (${posture.expiresAt.slice(0, 10)}) — re-mint before it lapses or every Start will fail.`);

    // ACCOUNT-CAPPING HAS A COST, AND THIS IS IT.
    //
    // A capped token names the accounts that existed when it was minted. Enrol a new customer and
    // their runs fail at the engine door with a refusal that names the token, not the enrolment — and
    // nothing connects the two. That is precisely the shape this portal keeps getting caught by: a
    // control that is correct, and a second place that had to be updated with it and was not.
    //
    // So the roster is compared against the cap at every boot. The check costs one directory read and
    // turns a future silent breakage into a line that says exactly which key is missing and why.
    if (posture.accountCapped) {
      try {
        // Same call the /portal/admin/roster route makes, deliberately: loadProfiles defaults to the
        // directory named by CLEAROTRON_CUSTOMERS_DIR, resolved at MODULE LOAD. Since
        // the settings surface reads that same variable — at CALL time — so the two now name one store
        // rather than two. They can still disagree if the variable is set after profiles.mjs loads, and
        // `doctor` reports that rather than leaving it to be discovered by a client.
        const { loadProfiles } = await import("./profiles.mjs");
        const roster = [...loadProfiles({ force: true }).values()].map((p) => p.key);
        // F51 — ONE COMPUTATION, asked here and by the surfaces a person is
        // actually looking at (`brandowner add`, `doctor`). This check was right and landed in a log
        // nobody reads; moving the answer into a shared function is what let the other two ask it
        // without a second opinion about what "uncovered" means.
        const { uncovered, union } = triggerCapGap({ accounts: posture.accounts, roster });
        if (uncovered.length) {
          // The suggested command is the UNION of the current cap and the roster, never the roster
          // alone. If this ever reads a directory that is not the configured one — an unset
          // CLEAROTRON_CUSTOMERS_DIR falls back to the bundled demo fixtures rather than failing — then
          // "--accounts <roster>" would be an instruction to STRIP every real customer from the token.
          // A warning that can talk someone into breaking production is worse than no warning; a union
          // is wrong in the harmless direction by construction.
          log(`WARNING: ${triggerCapWarning({ uncovered, union })}`);
        }
      } catch (e) {
        log(`trigger lane: could not read the roster to check the token's account cap (${e?.message ?? e}) — cap not verified against enrolment`);
      }
    }
  }
  const { mcpToolCall } = await import("./portal-mcp-client.mjs");
  const trigger = async (args) => {
    if (!MCP_URL || !OPS_TOKEN) throw new Error("PORTAL_MCP_URL / PORTAL_OPS_TOKEN unset — the trigger lane is not wired on this instance");
    return mcpToolCall({ url: MCP_URL, token: OPS_TOKEN, tool: "start_run", args });
  };
  const stopRun = async (args) => {
    if (!MCP_URL || !OPS_TOKEN) throw new Error("PORTAL_MCP_URL / PORTAL_OPS_TOKEN unset — the stop lane is not wired on this instance");
    return mcpToolCall({ url: MCP_URL, token: OPS_TOKEN, tool: "stop_run", args });
  };

  // The config surface. profile-service is constructed IN-PROCESS rather than called over HTTP: it
  // re-verifies a Cloudflare Access JWT on every request and the portal has no way to mint one. Calling
  // its router directly runs the SAME validators and the same git-commit path, with the portal's own
  // verified identity handed in as the author — one less hop, and no second auth domain to misconfigure.
  //
  // git commits land as the signed-in human, exactly as they do from the standalone editor.
  const upstream = await (async () => {
    try {
      const { makeProfileService } = await import("./profile-service.mjs");
      const { execFileSync } = await import("node:child_process");
      // — THE SAME STORE THE RUNS READ. This was `process.env.PROFILE_DIR ||
      // join(HERE, "profiles")`, and nothing set PROFILE_DIR, so every brand owner added the
      // documented way met "These settings are not available to you" while their clearance ran fine.
      const store = customerStoreDir({ bundledDir: join(HERE, "profiles") });
      const profileDir = store.dir;
      // Criterion 2 of — SAY WHICH STORE, the way `saved searches ON — store=…` does.
      // Logged HERE, before the containment guard below can throw, because a reader whose settings
      // surface went down needs the store it was ATTEMPTED against; the catch's "config surface
      // unavailable" alone sent the last reader to /proc to find out.
      log(customerStoreLine("settings surface", store));
      const repoRoot = process.env.PROFILE_REPO_ROOT || join(HERE, "..");
      const auditPath = process.env.PROFILE_AUDIT || join(profileDir, "_audit.log");
      // ── — A STORE THIS PROCESS COULD NEVER COMMIT TAKES THE CONFIG SURFACE DOWN, NOT THE PORTAL ──
      //
      // A save writes the file and then `git add`s it. Rooted at a repository that does not contain the
      // store, git refuses AFTER the write — the profile is live, the audit row records commit:null, the
      // orphan is untracked forever, and the next store sync refuses on the dirty tree. Measured on the
      // test box: 19 hours of blocked deploys from one save.
      //
      // THROWN, NOT FATAL, and that is this file's own ruling one screen down: "a settings surface that
      // cannot start must not take the whole portal down — clearances and reports are the load-bearing
      // product." The catch below turns this into a logged reason and a 404 on the config routes. A portal
      // that refused to boot would trade a broken editor for an outage.
      {
        const reach = storeInRepo(profileDir, repoRoot);
        if (!reach.ok)
          throw new Error(storeOutsideRepoMessage({ storeVar: "CLEAROTRON_CUSTOMERS_DIR", storeDir: reach.store, repoVar: "PROFILE_REPO_ROOT", repoRoot: reach.repo }));
      }

      // ── THE SKILLS OVERLAY, DERIVED RATHER THAN SEPARATELY CONFIGURED ────────────────────────────
      //
      // Constructing profile-service in-process means THIS process resolves a customer's risk-framework
      // files. It does that through `config.resolveSkillPath`, which reads the instructions dir — a knob
      // the portal's unit never set, because nothing about "run the portal" suggests you are also
      // configuring the engine's compute-skills tree.
      //
      // The result was not a failure. It was worse. With the overlay unset, resolveSkillPath falls back
      // to the PRODUCT REPO's own driver/skills — where the customer frameworks either do not exist
      // (a config-store-only customer → the page's fail-loud "could not be read" card) or exist as the SYNTHETIC
      // DEMO fixtures the sellable codebase ships (Aurora, Zephyr → "Aurora Interactive risk framework
      // (synthetic demo)", source_deck "content invented"). The second case renders with a title, a band
      // ladder and band meanings, and is indistinguishable on screen from the client's real framework.
      // A lawyer read invented risk definitions as their client's own for as long as this was live.
      //
      // Two knobs that must agree, set in two places, where disagreement is silent and looks correct, is
      // the defect. PROFILE_REPO_ROOT already names the config store; the skills tree is its `skills/`
      // child by the store's own layout. So derive it here rather than asking a deployment to say the
      // same thing twice.
      //
      // SCOPED DELIBERATELY TO THIS BOOTSTRAP. `config.skillsOverlayDir` is shared with the engine, and
      // profile-service's own unit sets the instructions dir correctly — neither should learn a fallback
      // from the portal's mistake. Setting the env var (rather than threading a value) is what the
      // getter reads, and this process never runs the engine.
      if (!envFrom(process.env, "CLEAROTRON_INSTRUCTIONS_DIR") && process.env.PROFILE_REPO_ROOT) {
        // `pinEnv`, not a bare assignment. This write lands at RUNTIME, long after `applyEnvAliases`
        // back-filled the spellings at load, so assigning one name reaches only the readers already
        // converted. `pinEnv` writes every spelling, which is what keeps a half-converted tree honest.
        pinEnv(process.env, "CLEAROTRON_INSTRUCTIONS_DIR", join(repoRoot, "skills"));
        log(`skills overlay derived from PROFILE_REPO_ROOT: ${envFrom(process.env, "CLEAROTRON_INSTRUCTIONS_DIR")}`);
      }
      // FAIL LOUD, NEVER FALL BACK. A missing overlay does not error — it resolves every framework to the
      // repo's demo fixtures, which is exactly the silence this guard exists to break. Mirrors the
      // roster-vs-ops-token boot check below: one directory read, once, at boot.
      const overlay = envFrom(process.env, "CLEAROTRON_INSTRUCTIONS_DIR");
      if (!overlay || !existsSync(overlay)) {
        // — SAME FACT, DIFFERENT READER. In a demo there is no customer whose
        // framework could be shown wrongly: Demo Brand Owner rates under the generic default, which is
        // the real house rubric rather than a fixture. Naming two environment variables and a config
        // store at a first-time visitor tells them the thing they just started is broken — and this
        // output is what gets captured for the website.
        //
        // OUTSIDE A DEMO IT IS UNCHANGED AND STILL A WARNING. It is load-bearing on a real deployment:
        // it says a page may show synthetic data as though it were a customer's own, which is exactly
        // the class of thing that must stay loud. The defect was the audience, not the content.
        const posture = demoPostureLine(process.env);
        if (posture) log(posture);
        else log(`WARNING: skills overlay ${overlay ? `unreadable (${overlay})` : "unset"} — customer risk `
          + `frameworks will resolve to this repo's demo fixtures and the Brand profile page will show `
          + `either "could not be read" or a SYNTHETIC framework as though it were the customer's own. `
          + `Set CLEAROTRON_INSTRUCTIONS_DIR (or PROFILE_REPO_ROOT) to the config store.`);
      }
      // — SAY IT WHEN IT HAPPENS. The core catches this and reports `commitError` on the response and
      // in the audit row, both read by whoever made the save and nobody else. A failed commit leaves a
      // permanent sync blocker, so the service journal needs it too: the boot check above removes the
      // CONFIGURATION cause, not index.lock contention, a detached HEAD, a hook, or a full disk.
      // — the shared committer; see shared/store-in-repo.mjs for why nothing un-stages.
      const committing = (root, what) => makeStoreCommit({ repoRoot: root, log, what });
      const gitCommit = committing(repoRoot, "profile");
      // — returns the path when it is committable, so the save stages the row with the change.
      const profAudit = makeCommittableAudit({ auditPath, repoRoot });
      // readLayered —: this construction serves the DEPLOYMENT, whose store the
      // engine reads overlay-over-base with `generic` falling through. Reading the store dir alone
      // here 500'd every Profiles screen on the empty store the wizard creates, while every clearance
      // ran fine — the two surfaces answered from different views of the same configuration.
      const profiles = makeProfileService({ profileDir, readLayered: true, gitCommit, audit: profAudit });

      // Saved searches ride the SAME in-process trick, and the same reasoning: recipe-service also
      // re-verifies a Cloudflare Access JWT the portal cannot mint, so its router is called directly.
      //
      // THE TENANCY NOTE THAT MATTERS: recipe-service's own routes take the customer as a PATH SEGMENT
      // and gate it only against the roster — an existence check, not an ownership one. It was built as
      // a staff tool behind CF Access, where that was sufficient. It is not sufficient here. The wrapper
      // in portal-upstream is what makes it client-safe: every saved-search route builds its path from
      // the account `resolveAccount` returned, so a caller's own words never reach the customer segment.
      // That is why these routes are mounted through `makeUpstream` and not proxied directly.
      //
      // NAMED, NEVER GUESSED: with CLEAROTRON_RECIPES_DIR unset there is no store, so `callRecipes` stays
      // null and every saved-search route answers 404. The alternative — falling back to the in-repo
      // driver/recipes/ — would write a real customer's search into the source tree's synthetic demo
      // directory. The engine refuses that fallback for the same reason; so does this.
      const recipesDir = process.env.CLEAROTRON_RECIPES_DIR || "";
      let callRecipes = null;
      // — the recipe store's own reachability, decided BEFORE the branch so an unreachable one turns
      // saved searches off rather than throwing. A throw here would land in the catch below and take the
      // PROFILE surface down with it, and the two stores are configured independently: `recipeRepoRoot`
      // falls back to the profile repo root, so a correct profile setup can carry an incorrect recipe one.
      // — THE SAME RESOLVER THE STANDALONE SERVICE USES. This door and that one disagreed, and the
      // disagreement was invisible because each was correct on its own terms. `repoRoot` here is already
      // the profile root, so this door's ANSWER is unchanged — what changes is that the answer now comes
      // from one place, and a future edit to the order moves both doors together.
      const recipeResolved = resolveStoreRepoRoot({ names: ["RECIPE_REPO_ROOT", "PROFILE_REPO_ROOT"], fallback: repoRoot });
      const recipeReach = recipesDir ? storeInRepo(recipesDir, recipeResolved.root) : null;
      if (recipesDir && !recipeReach.ok) {
        log(`saved searches OFF — ${storeOutsideRepoMessage({ storeVar: "CLEAROTRON_RECIPES_DIR", storeDir: recipeReach.store, repoVar: "RECIPE_REPO_ROOT", repoRoot: recipeReach.repo })} `
          + `The repo root came from ${recipeResolved.from} (tried ${recipeResolved.tried.join(", ")} in that order). `
          + "Routes answer 404 rather than accepting a save that would orphan its file.");
      } else if (recipesDir) {
        const { makeRecipeService } = await import("./recipe-service.mjs");
        const recipeRepoRoot = recipeResolved.root;
        const recipeAuditPath = process.env.RECIPE_AUDIT || join(recipesDir, "_audit.log");
        const recipeCommit = committing(recipeRepoRoot, "saved-search");
        // — same, against the RECIPE repo root, which may differ from the profile one.
        const recAudit = makeCommittableAudit({ auditPath: recipeAuditPath, repoRoot: recipeRepoRoot });
        const recipes = makeRecipeService({ recipesDir, profileDir, gitCommit: recipeCommit, audit: recAudit });
        callRecipes = (method, path, body, identity) => recipes.route(method, path, { email: identity?.email }, body ?? {});
        log(`saved searches ON — store=${recipesDir} repo=${recipeRepoRoot}`);
      } else {
        log("saved searches OFF — CLEAROTRON_RECIPES_DIR unset, so /portal/api/config/searches answers 404");
      }

      return makeUpstream({
        callUpstream: (method, path, body, identity) => profiles.route(method, path, { email: identity?.email }, body ?? {}),
        callRecipes,
      });
    } catch (e) {
      // A settings surface that cannot start must not take the whole portal down — clearances and
      // reports are the load-bearing product. The routes answer 404 and the reason is logged once.
      log(`config surface unavailable: ${String(e?.message ?? e)}`);
      return null;
    }
  })();

  // The brief reader, if this box was given a model credential.
  //
  // WHY THE UNIT MUST NAME IT. trademark-portal.service carries NO EnvironmentFile — deliberately, so
  // that sourcing the shared .env cannot drag CLEAROTRON_OIDC_AUDIENCE in and make this service trust the wrong
  // Cloudflare application. The rule the unit writes down is "every value arrives named", and this is
  // a named value: a drop-in with ANTHROPIC_API_KEY, nothing else. Absent, the feature stays dark and
  // the rest of the portal is untouched — which is why it is safe to ship this before the key lands.
  const composeRead = await (async () => {
    // THROUGH THE ENGINE DOOR. This used to read a raw ANTHROPIC_API_KEY and build
    // its own SDK client, which made the button impossible to switch on precisely where the product
    // recommends: `driver/engine/anthropic-agent.mjs` DELETES that key on a subscription box to force
    // one billing mode, and this required it. The owner hit it composing a live matter and was told the
    // feature was "not switched on here yet", which reads as a toggle nobody flipped rather than a thing
    // that cannot be flipped without changing how the box is billed.
    //
    // Supplying the key would have been worse than the bug: metered API spend beside subscription stages
    // on one box is the mix the owner's "one LLM provider only ever, API or auth, no mix" ruling ended.
    // Going through `runTurn` means the reader is on whatever the engine is already authenticated as,
    // so it works on a subscription box, works on a codex box, and adds no credential.
    try {
      const { makeJxTurnRunner } = await import("./engine/jx-turn.mjs");
      const { makeComposeReader } = await import("./compose-read.mjs");
      // SONNET, THINKING OFF — the owner's ruling for this reader, and NOT the jx lanes' haiku/low. The
      // two are parameters on the shared runner for exactly this reason: `compose-read.mjs` records that
      // Haiku 4.5 refuses a thinking block outright (400), so inheriting the jx constants here would
      // have been a failure on every press.
      const model = process.env.PORTAL_READ_MODEL || "claude-sonnet-5";
      const runner = await makeJxTurnRunner({ model, thinking: "off", lane: "the brief reader" });
      if (runner?.error) {
        // NAMES THE CONDITION, on the operator's surface. The client-facing note stays client-facing;
        // this is the line whose absence made a billing posture look like a forgotten switch.
        log(`brief reading OFF — ${runner.error}. Describe-it stays disabled; \`npx clearotron doctor\` reports the engine's auth state.`);
        return null;
      }
      log(`brief reading ON — engine=${runner.engine} billing=${runner.authMode} model=${model}`);
      return makeComposeReader({ turn: runner.turn });
    } catch (e) {
      // A missing dependency or a bad key shape must not stop the portal booting: everything else on
      // this service is the load-bearing product, and the composer degrades to exactly what it did
      // before this feature existed.
      log(`brief reading OFF — ${String(e?.message ?? e)}`);
      return null;
    }
  })();

  // — the control's honesty is decided by the LIVE token, read once at boot. The
  // warning above already prints the remedy for operators; this is the half a user meets.
  const stopControl = !OPS_TOKEN || !MCP_URL
    ? { available: false, reason: "the stop lane is not wired on this instance (PORTAL_MCP_URL / PORTAL_OPS_TOKEN unset)" }
    : (Array.isArray(posture.verbs) && !posture.verbs.includes("stop_run"))
      ? { available: false, reason: `the ops token's verbs are [${posture.verbs.join(", ")}] — it cannot stop_run; re-mint with stop_run included` }
      : { available: true, reason: null };
  const service = makePortalService({ poolRoot: config.poolRoot, workspaceRoot: config.workspaceRoot,
    // Re-read per request (a getter that rescans), so a workspace created after boot is counted.
    queueDirs: () => config.queueDirs,
    secret, staffDomains, grants, trigger, stopRun, audit, auditPath, upstream, composeRead, stopControl,
    // — the ONLY place the environment is read for this. `bin/start.mjs` is the
    // only thing that sets it, and it sets it explicitly rather than passing the operator's inherited
    // environment through, so a stray `.env` can neither put a live install into demo mode nor take a
    // demo out of one. Anything but the literal "1" is not a demo.
    demo: isDemo(process.env) });   // — one name, shared with the MCP door
  const { RateLimiter } = await import("../mcp-server/lib/ratelimit.mjs");
  const limiter = new RateLimiter({ perMinute: Number(process.env.PORTAL_RATE_PER_MIN || 120) });
  const { createServer } = await import("node:http");

  // ──: the local identity provider, wired last ──────────────────────────────────────────────
  //
  // LAST on purpose. Establishing a credential prints a passphrase and tells somebody to keep it, and a
  // boot that is going to refuse for a missing roster or an unreadable grants file must refuse BEFORE
  // it does that — a passphrase printed by a process that then exits 1 is a passphrase somebody saves
  // for a portal that never ran.
  const localAuth = await (async () => {
    if (!LOCAL_MODE) return null;
    // — ONE DEFINITION, in portal-local-auth.mjs. The `passphrase` verb resets this same file;
    // resolving it twice is how a reset mints a credential the portal never reads.
    const credentialPath = credentialPathFor();
    let record;
    try {
      record = readLocalCredential(credentialPath);
    } catch (e) {
      // A credential file that exists and cannot be read is NOT "no user configured". Treating it as
      // one would mint a fresh passphrase over the working credential and lock out whoever holds it,
      // which is why readLocalCredential throws rather than returning null — and why this exits
      // instead of catching on.
      log(`FATAL: ${String(e?.message ?? e)} — refusing to start.`);
      process.exit(1);
    }
    if (!record) {
      // FIRST RUN. The one and only place a passphrase is ever printed; nothing logs it again, and the
      // record on disk is a scrypt digest, so this line is the only copy that will ever exist.
      // — decided BEFORE the mint, so an undeliverable credential is never
      // created. localCredentialHandoff carries the reasoning.
      const resetCommand = `${invocationPrefix()}clearotron passphrase --reset`;
      const handoff = localCredentialHandoff({ isTTY: !!process.stderr.isTTY, resetCommand });
      if (handoff.refusal) {
        log(`FATAL: ${handoff.refusal}`);
        process.exit(1);
      }
      let established;
      try {
        // ── THE SUPERVISOR MAY HAND ONE DOWN ( — F10) ──────────────────────
        //
        // On a first FOREGROUND start the supervisor mints, so its closing summary can print the value
        // beside the address instead of telling the reader to scroll back into eleven lines of startup
        // log for the one value in this product that cannot be read back. Absent — every background
        // start, every restart — this mints its own exactly as before.
        //
        // NEVER PERSISTED. It reaches this process through the spawn call alone and is deliberately not
        // part of the composed portal environment, because that composition is also what gets written to
        // the units' env file. An arm holds that line: the whole design says the passphrase is stored
        // only as a digest, and a plaintext copy in an env file would make that sentence false.
        established = establishCredential({
          path: credentialPath, email: LOCAL_USER,
          passphrase: String(process.env.PORTAL_LOCAL_PASSPHRASE ?? "").trim() || null,
        });
      } catch (e) {
        log(`FATAL: could not write the local credential to ${credentialPath} (${String(e?.message ?? e)}) — refusing to start.`);
        process.exit(1);
      }
      // The secret is handed to the composer ONLY on the branch that prints it. Passing it on the other
      // branch is the wiring mistake the arm plants for, and it would not be visible in the output.
      for (const line of firstRunCredentialLines({
        handoff, credentialPath, email: LOCAL_USER, resetCommand,
        passphrase: handoff.printPassphrase ? established.passphrase : null,
      })) log(line);
      record = readLocalCredential(credentialPath);
    } else {
      // The credential names the address it was minted for. If the configured user has changed since,
      // the passphrase on disk belongs to somebody else's sign-in — say so rather than answering every
      // attempt with "that passphrase is not correct" and leaving the operator to guess why.
      if (record.email !== LOCAL_USER) {
        log(`FATAL: the credential at ${credentialPath} was created for ${record.email}, but PORTAL_LOCAL_USER is ${LOCAL_USER}. Point PORTAL_LOCAL_CREDENTIAL at a different file (a new passphrase will be created for the new address) or set PORTAL_LOCAL_USER back. Refusing to start.`);
        process.exit(1);
      }
      log(`local sign-in: credential for ${LOCAL_USER} read from ${credentialPath}`);
    }
    // The roster still decides. A local sign-in produces an email and nothing else; if that address is
    // in neither the grants file nor a staff domain, makePrincipal returns null and the door 403s —
    // exactly as it would for a Cloudflare-verified stranger. Warned at boot because the symptom
    // otherwise arrives as "I signed in and got refused", which reads as a broken login.
    try {
      if (!makePrincipal({ email: LOCAL_USER, grants: grants(), staffDomains }))
        log(`WARNING: ${LOCAL_USER} can sign in but holds no portal access — it is on no staff domain (PORTAL_STAFF_DOMAINS) and in no grants row (CLEAROTRON_ACCESS_FILE), so every page will refuse it at the door. Add it to one of them.`);
    } catch (e) {
      // A WARNING must never be the thing that takes the service down. The grants file was already
      // read successfully by the mandatory guard above; anything that fails here is a race with
      // something rewriting it, and the per-request loader will report it honestly on the first
      // request that needs it.
      log(`local sign-in: could not check ${LOCAL_USER} against the roster (${String(e?.message ?? e)}) — enrolment not verified at boot`);
    }
    const TTL_SEC = 60 * 60 * 12;
    return {
      email: LOCAL_USER,
      secret,
      ttlSec: TTL_SEC,
      // Re-read per request, the same idiom the grants file uses: replacing the credential file takes
      // effect without a restart, and a file that goes corrupt later is a refusal with a reason rather
      // than a stale copy held in memory.
      credential: () => readLocalCredential(credentialPath),
      attempts: makeAttemptLimiter({ max: 10, windowMs: 5 * 60 * 1000 }),
    };
  })();

  // portal-ui/dist is COMMITTED to git, so a missing bundle means a bad checkout rather than a skipped
  // build. Not fatal on purpose: the API is independently useful (the MCP face, the connector, a
  // debugging curl), and taking the whole service down over a UI asset would turn a cosmetic failure
  // into an outage. It is loud instead — 503 with the reason, and `ui` on /portal/health.
  const distDir = pathResolve(HERE, "..", "portal-ui", "dist");
  const staticHandler = makeStaticHandler({ distDir });
  if (!staticHandler.present()) log(`WARNING: no UI bundle at ${distDir} — /portal will answer 503 until it is restored`);
  // No `devIdentity` here, and there is no environment variable that can supply one. It survives on
  // makeHttpHandler purely so an in-process test can inject an identity without a socket; the deployed
  // service has exactly two identity sources and both of them prove something.
  //: the bind failure is the helper's, not this block's. It does NOT retry — a portal that quietly
  // moved off PORTAL_SERVICE_PORT would leave the tunnel in front of it pointing at the old address.
  const { listenOrDie } = await import("../shared/listen.mjs");
  listenOrDie(createServer(makeHttpHandler({ verify, limiter, service, log, localAuth, static: staticHandler, authHeader: AUTH_HEADER })), {
    port: PORT, host: HOST, what: "the portal service", portVar: "PORTAL_SERVICE_PORT", portSource: PORT_CHOICE.source, log,
    // "AUTH OFF (dev)" is gone with the switch that produced it: this line now names WHICH door is
    // open, and there is no longer a third state where none is.
    onReady: ({ port: bound }) => log(`listening on http://${HOST}:${bound}/portal — pool=${config.poolRoot} ui=${staticHandler.present() ? "built" : "MISSING"} auth ON (${verify ? "CF Access" : "local sign-in"})`),
  });
}
