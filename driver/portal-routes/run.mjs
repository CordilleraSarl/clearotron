// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// portal-routes/run.mjs — a search from plan to start: the confirmed plan, the order that spends, stopping a run, and a
// run's summary.
//
// One of the portal service's route groups, moved out of its dispatcher unchanged; makePortalService says how it asks them.
import { join } from "node:path";
import { BRAND } from "../../shared/brand.mjs";
import { gateResolvedRequest, resolveForDoor } from "../door-gates.mjs";
import { validateJob } from "../enqueue-schema.mjs";
import { assertPrincipal, mayReadRun, seesEverything } from "../portal-access.mjs";
import { jobHashOf, mintConfirmation, verifyConfirmation } from "../portal-confirmation.mjs";
import { batchSummaryOf } from "../portal-report.mjs";
import { scanAccountRuns } from "../portal-runs.mjs";
import { baseTurnaroundFor, productRow } from "../product-rows.mjs";
import { quoteForJob } from "../run-quote.mjs";
import { readJson } from "../run-record.mjs";
import { countJobMarks, coverageDisclosure, kebabCollisions, policyFor, productAvailability, UNAVAILABLE_NOTE } from "../search-policy.mjs";
import { accountUsage, DEFAULT_CLIENT_DAILY_RUNS } from "../usage-ledger.mjs";

export async function runRoutes({ poolRoot, workspaceRoot, secret, queueDirs, trigger, stopRun, demo, orderRefusal, audit, upstream, readBuilt, readCanCount, readTerritories, loadProfilesImpl, usedJtis, sweepJtis, jobFor, selectorOf, refusalFor, allowanceExhaustedLine }, { method, parts, principal, body, query }) {
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
    // the account's default and its own territories, and the old read (`body.searchLevel || "clearance"`)
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
   * A person who sees everything is never checked; the cap binds everyone else, decided here from the principal.
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

  const quotaRefusal = async (account, organisation = null) => {
    if (seesEverything(principal) || !upstream) return null;
    let caps = null, capsRead = false;
    try {
      // Generic's caps are the neutral profile's — one file, every organisation's lane — so they are
      // read from the store rather than through the settings wall, which answers per company.
      if (account === "generic") { caps = (await loadProfilesImpl()).get("generic")?.runCaps ?? null; capsRead = true; }
      else {
        const r = await upstream.getProfile(principal, account);
        if (r.status === 200) { caps = r.json?.readOnly?.runCaps ?? null; capsRead = true; }
      }
    } catch { return null; }   // cannot read the cap ⇒ do not invent one; the wall still holds
    // The same DEFAULT the wall applies (runner.mjs DEFAULT_CLIENT_DAILY_RUNS): a profile READ
    // successfully with no dailyRuns is capped, not uncapped. Mirrored rather than imported because
    // portal-service must not pull the runner into a request path; a test pins the two constants.
    // An UNREADABLE profile is different and gets no pre-check at all — inventing a limit we could
    // not read would refuse a client whose profile may say something larger. The wall still holds.
    if (!capsRead) return null;
    const limit = Number.isInteger(caps?.dailyRuns) ? caps.dailyRuns : DEFAULT_CLIENT_DAILY_RUNS;
    if (!Number.isInteger(limit)) return null;
    const used = accountUsage({ queueDirs: queueDirs(), account, organisation });
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
    return { status: 429, json: { ok: false, errors: [allowanceExhaustedLine(limit, BRAND.name)] } };
  };

  // ── AN INSTALL THAT CANNOT SEARCH REFUSES HERE, WHERE THE PERSON IS ─────────────────────────
  //
  // The runner asks this at intake and refuses the order there (runner.mjs, `orderTimeRefusal`). The portal
  // asked nothing: it said "queued", the runner's refusal reached only its terminal and a sidecar in the
  // queue, and the order then vanished from every page, which is the outcome the queue scan's own rule
  // above says belongs at submission. So the review and the start both ask the runner's question, of the
  // runner's tables, and nothing is queued. Neither sentence names a setting, which a browser must never be
  // shown: the client one the runner already writes, or what is missing and the command that sets it, for the
  // person who runs the install (refusalFor). A demo walks its own flow and is not asked.
  // `code` lets the screen give the box its own heading rather than the edited-review one, and the audit row is
  // the operator's record of the refusal: the order doors are not admin writes, so nothing files one for them.
  const configurationRefusal = async (door, account) => {
    if (demo) return null;
    const refusal = await orderRefusal();
    if (!refusal) return null;
    audit({ event: door === "plan" ? "plan" : "trigger", by: principal.email, account, ok: false, refused: "not_configured", missing: refusal.names });
    return { status: 409, json: { ok: false, errors: [refusalFor(principal, refusal)], code: "not_configured" } };
  };

  // /portal/api/run/plan — the confirmation gate (no spend)
  if (parts[1] === "api" && parts[2] === "run" && parts[3] === "plan" && method === "POST") {
    const tenant = body.tenant ?? query.tenant ?? null;
    const account = assertPrincipal(principal, { account: body.account ?? query.account ?? null, tenant, run: true });
    if (!account) return { status: 400, json: { error: "name an account (?account=)" } };
    const job = jobFor({ principal, account, tenant, body });
    const notConfigured = await configurationRefusal("plan", account);
    if (notConfigured) return notConfigured;
    const gates = planGates(job);
    if (gates.fail) return gates.fail;
    const overQuota = await quotaRefusal(account, job.tenant ?? null);
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
    const account = assertPrincipal(principal, { account: body.account ?? null, tenant: body.tenant ?? null, run: true });
    if (!account) return { status: 400, json: { error: "name an account" } };
    const job = jobFor({ principal, account, tenant: body.tenant ?? null, body });
    const notConfigured = await configurationRefusal("trigger", account);   // asked again: the install may have changed since the review
    if (notConfigured) return notConfigured;
    const gates = planGates(job);   // re-gated: the token is necessary, never sufficient
    if (gates.fail) return gates.fail;
    // re-checked for the same reason the gates are: a token minted while the account still had
    // allowance must not spend it after another tab has used the last one.
    const overQuota = await quotaRefusal(account, job.tenant ?? null);
    if (overQuota) return overQuota;
    sweepJtis();
    const bad = verifyConfirmation({ secret, token: body.confirmationToken, account, email: principal.email,
      jobHash: jobHashOf(job), usedJtis });
    if (bad) return { status: 409, json: { ok: false, error: bad } };
    const selector = selectorOf(body);
    // ── — A DEMO WALKS THE REAL FLOW AND LANDS ON A FINISHED RUN ─────────
    //
    // Ruling, 2026-08-31, revising his own ruling of an hour earlier: "i think its OK for
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
      const deliveredFor = (scope) => scanAccountRuns({ poolRoot, workspaceRoot, account: scope, queueDirs: queueDirs() })
        .filter((x) => x.state === "delivered" && x.product === want);
      let finished = deliveredFor(account);
      // GENERIC HOLDS NO EXAMPLE OF ITS OWN. A demo's reports are filed under the company that carries them, and
      // Generic is first on the picker and marked Default, so every search ordered from it was refused while the
      // banner said each one opens a report. It looks across what this principal may open, which keeps the rule above.
      if (!finished.length && account === "generic") finished = deliveredFor(principal.accounts === "*" ? null : principal.accounts);
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
        // The daily-allowance stamp. Set ONLY here, on everyone but a person who sees everything —
        // this is the one place in the system where that is decided. See checkRunCaps for why the
        // polarity is positive-only and why every inferred alternative fails unsafely.
        ...(!seesEverything(principal) ? { clientPrincipal: true } : {}),
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
      const staff = seesEverything(principal);
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
    const account = assertPrincipal(principal, { account: query.account ?? null, tenant: query.tenant ?? null, run: true });
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
    // Ruling, on his second encounter with the same wait: "a stop is a stop — maybe it should
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
        error: seesEverything(principal) ? detail : `The run could not be stopped just now. It is still running, and ${BRAND.name} can see what happened.` } };
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
    //
    // AND "IMMEDIATE" MEANS THE STEP WAS SEEN TO END. `signalled` says only that a signal was accepted
    // for delivery; `ended` is what the driver saw afterwards. An answer without it, an older driver's
    // `ended: null` included, is the boundary stop: that is the honest reading of an answer that does
    // not say.
    const mode = r?.immediate?.attempted && r?.immediate?.ended === true ? "immediate" : "boundary";
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
  // edge serves. Ruling 2026-08-26: the grouped page carries it.
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
    let meta; try { meta = readJson(join(dir, "meta.json")); } catch { return { status: 404, json: { error: "not_found" } }; }
    const owner = meta.customerKey || "generic";
    if (!mayReadRun(principal, { owner, organisation: meta.organisation ?? null })) return { status: 404, json: { error: "not_found" } };
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

  return undefined;
}
