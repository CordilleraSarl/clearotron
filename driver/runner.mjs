// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// runner.mjs — queue claim + dispatch. On the deployed VM it is activated by the systemd `.path` unit the
// instant a job file lands, and re-fired every ~90s by the `prelim-driver.timer` fallback (so a queue the
// `.path` doesn't watch still drains). NOT a cron job and NOT an agent (agents have exec denied) —
// this is a plain OS service process.
//
// WHERE THERE IS NO SYSTEMD — every macOS laptop and most first-time installs — `--watch` is the substitute
// (see `watch()` below). It calls the SAME `main({ once: true })` systemd calls, on the timer's own 90s
// cadence, so every recovery path here has a trigger on a machine that has no units at all. Nothing about
// the systemd lane changes: `--watch` is additive and off by default.
//
// Drains EVERY agent workspace's queue (config.queueDirs). A job is run as the agent whose workspace it sits
// in — derived from the queue LOCATION (workspace-<agentId>/…/queue) — so the reply tool, run-dir, and memory
// all line up with the forwarding agent. Per job: atomic-claim (<id>.json → <id>.processing) so only one runner
// wins, run pipeline() as that agent, then mark <id>.done / <id>.failed IN THE ORIGIN QUEUE (so each agent sees
// its own job's terminal state). Crash-safe: dispatch persists the run identity to `<id>.processing.meta` BEFORE
// any spend, so on start the re-claim of a dead claimer's .processing RESUMES that same run (pipeline skips
// stages whose output already validates) — or consumes it as .done when the run already delivered.

import "../shared/env-local.mjs";   // side effect: apply <repo>/.env when THIS file is the CLI entry (never on library import)
import "./engine/mcp/http-dispatcher.mjs";   // side effect: raise undici headersTimeout (code-side fetches)
import { readdirSync, renameSync, existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, rmSync, statSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { driverDir, ensureDriverDir } from "../shared/driver-dir.mjs";   // — one definition of where `_driver/` is
// The queue's filename vocabulary, in ONE place — 's rule, extended by to the prose-sidecar and
// claim-sidecar names, because a harness check retyped four of them from memory and false-alarmed on the
// other nine. Behaviour here is unchanged: the same object and the same three suffixes, sourced.
import { isLiveQueueMarker, PROSE_PARTS, CLAIM_SIDECAR_SUFFIXES, TERMINAL_QUEUE_SUFFIXES } from "./queue-markers.mjs";
import { matterLedgerPath } from "./usage-ledger.mjs";   // ONE ledger-path calculation, shared with the portal pre-check
import { fileURLToPath } from "node:url";
import { config, preflightDeploymentUrls } from "./driver.config.mjs";
import { deriveSlug, todayISO, mintFreshCodename } from "./phase0.mjs";
import { pipeline, buildFailurePacket, retiredEnvWarnings, terminalReasonFields } from "./pipeline.mjs";
import { validateJob, wantsPortalRoute, PORTAL_ROUTE_UNAVAILABLE } from "./enqueue-schema.mjs"; import { demoRunAgreement } from "./demo-run-agreement.mjs";
import { resolveEffectiveProfile, recipeProseGuard } from "./profiles.mjs";
import { gateResolvedPolicy, loadRecipes, policyFor } from "./search-policy.mjs";
import { resolveRequest } from "./resolve-request.mjs";   // product + scope, sequenced once for every door
import { zhScopeDepthNotes } from "./jx-lanes.mjs";   // qw/cn-scope-honesty (b) — pure zero-import leaf; note-only, never gates
import { checkResolvedProduct } from "./scope-rules.mjs";   // every resolved-product rule — this door is THE WALL for them
import { freeSlots } from "./slot-lock.mjs";   // admission arithmetic — see drainQueue
import { orderedQueueFiles } from "./queue-order.mjs";   // the order jobs are admitted in (shared with the portal)
import { isCancelled } from "./cancel.mjs";   // a stopped run must not come back through any resume path
import { AGENT_WHATSAPP } from "./stages.mjs";
import { writeOutboxPacket } from "./outbox.mjs";
import { writeRunStatus, terminalRunState } from "./progress.mjs";   // A5 — grace-exit park + reclaim-bound terminal go through the guarded status writer; terminalRunState is the run record's own terminal vocabulary (2155)
import { identitySeed } from "./progress.mjs";   // — the same stamp a run seeds, for the process that runs them
import { writeDrainerStamp } from "./drainer-identity.mjs";   // — deploy health cannot interrogate a running process; it says so itself
import { note, runLog } from "./log.mjs";
import { stopReason } from "../shared/stop-reason.mjs";   //
// — the RUN-LOCAL what-if queue a client's experiment waits in. Both imports are
// leaf modules (fs + path); the module that actually spawns the engine is loaded lazily inside the drain.
import { pendingWhatIf } from "./whatif-queue.mjs";
import { drainWhatIfQueues, liveRunDirs } from "./whatif-worker.mjs";

// PROSE_PARTS — the raw plain-text sidecars a job's prose is carried in — now lives in queue-markers.mjs
// beside the rest of the queue's filename vocabulary. It moved because scripts/e2e.mjs needs it and must
// not import this module (that chain reaches driver.config.mjs, whose unset-env defaults are PRODUCTION).

// Assemble a job from its scalar manifest (the claimed <base>.processing, JSON) + any prose sidecars (raw utf8,
// keyed by <base>). Throws ONLY on a malformed manifest (scalars) — prose is never parsed, so it can never
// throw. A self-contained LEGACY job (prose inline in the JSON, no sidecars) assembles unchanged: the overlay
// loop is a no-op. A present, non-empty sidecar overrides the manifest's value for that field (sidecar wins).
function assembleJob(procPath, qdir, base) {
  const job = JSON.parse(readFileSync(procPath, "utf8"));
  // Prose sidecars share the job's BARE base (<id>.markName.md, …). A manifest mis-named `<id>.manifest.json`
  // — an observed forwarding-agent fumble (live, 2026-06-19) — leaves `base` as "<id>.manifest", so the
  // bare-base sidecars stop matching and the mark name never overlays → the job parks "missing mark name(s)".
  // Tolerate it: fall back to the `.manifest`-stripped base when the exact-base sidecar is absent. No-op for a
  // canonical `<id>.json` (sbase === base). A code gate, not a prompt — intake must not hinge on a perfect name.
  const sbase = base.replace(/\.manifest$/, "");
  for (const [field, suffix] of Object.entries(PROSE_PARTS)) {
    const exact = join(qdir, `${base}${suffix}`);
    const p = existsSync(exact) ? exact : join(qdir, `${sbase}${suffix}`);
    if (existsSync(p)) {
      const v = readFileSync(p, "utf8"); // RAW — no JSON.parse, no unescape; verbatim into the run artifacts
      if (v.trim()) job[field] = v;
    }
  }
  return job;
}

// Best-effort sweep of a job's prose sidecars once it reaches a terminal state, so a drained queue leaves no
// residue. Sidecars are NEVER renamed on claim (they must survive a .processing crash-reclaim so a resumed run
// re-assembles the same prose) — they are only removed here, at the end, keyed by base.
function cleanupProseParts(qdir, base) {
  const sbase = base.replace(/\.manifest$/, "");   // mirror assembleJob's tolerant base (the `.manifest.json` fumble)
  for (const suffix of Object.values(PROSE_PARTS)) {
    try { rmSync(join(qdir, `${base}${suffix}`), { force: true }); } catch { /* best-effort */ }
    if (sbase !== base) { try { rmSync(join(qdir, `${sbase}${suffix}`), { force: true }); } catch { /* best-effort */ } }
  }
}

// ── Matter-level dedup (the "please proceed" double-enqueue — observed live, 2026-06-16) ───────────────────
// The queue's dedup key is job.id = the per-MESSAGE id, so a follow-up in an already-handled thread (a
// "please proceed" ack, a clarification) re-runs intake and enqueues the SAME matter under a NEW id — a
// second ~$40 search for one matter, invisible to id-based uniqueness. This gate keys on the MATTER
// (forwarder + mark + classes + customer) via a tiny append-only ledger ONE LEVEL ABOVE the queue, so a
// duplicate is PARKED (recoverable), never run. Pure driver code — no agent cooperation, can't be "tried
// harder" around. Window is generous-but-bounded so a deliberate re-run the next day still runs. It was
// settable, and nothing ever set it; step 3 made it the constant it always was.
const DEDUP_WINDOW_MS = 24 * 3600000;   // step 3 — 24h, was a knob nothing set

// Stable signature of the MATTER (not the message): normalized so casing / spacing / class-order drift
// between an original request and its reply still collide on the same signature. `ref` (the TMP reference)
// is included so two DISTINCT matters that share a mark+classes (different TMP numbers) are NOT deduped —
// a proceed-reply re-captures the same ref (or both are refless), so the real duplicate still collides.
function matterSignature(job, { product = null } = {}) {
  // (a) a BATCH job (a multi-name knockout) keys on the FULL sorted mark set — keying on marks[0] alone
  // made two different batches sharing their first mark collide while a reordered re-send of the same
  // batch did not; (b) the resolved PRODUCT is a signature dimension so a product CHANGE never dedups
  // (the knockout→clearance escalation is the offering's headline flow — an £X screen must not park the
  // £XX clearance as a duplicate). Both are suffix/branch-only: a single-mark job with no explicit
  // product produces the EXACT pre-spine string, so every existing ledger entry, test anchor and
  // in-window dedup keeps working byte-identically.
  const norm = (s) => String(s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  // The RESOLVED product when the caller has it (claimAndPrep), else the job's explicit field.
  const lvl = norm(product ?? job.product ?? "");
  const names = Array.isArray(job.marks) ? job.marks.map((m) => (typeof m === "string" ? m : m?.name)).filter(Boolean) : [];
  // The sorted-set batch form applies ONLY to the knockout pipeline (review 2026-07-17): a legacy
  // multi-mark job on a clearance keys on markName exactly as before (byte-identity), because the
  // clearance pipeline runs ONE matter regardless of how many marks ride the array.
  const batch = names.length > 1 && policyFor(lvl)?.pipeline === "knockout";
  const mark = batch
    ? [...new Set(names.map(norm))].sort().join(" + ")
    : norm(job.markName ?? job.name ?? names[0] ?? "");
  const classes = [...new Set([
    ...(Array.isArray(job.classes) ? job.classes : []),
    ...(Array.isArray(job.marks) ? job.marks.flatMap((m) => (Array.isArray(m?.classes) ? m.classes : [])) : []),
  ].map(Number).filter(Number.isFinite))].sort((a, b) => a - b).join(",");
  const customer = String(job.customer ?? "").trim().toLowerCase();
  const forwarder = String(job.forwarder ?? "").trim().toLowerCase();
  const ref = String(job.ref ?? job.tmp ?? "").trim().toLowerCase();
  const base = `${forwarder}|${mark}|${classes}|${customer}|${ref}`;
  // Product dimension. ONE product adds nothing to the string, and it has to be one or every legacy
  // ledger row would stop colliding with its own re-send: the pre-spine signature had no suffix at all,
  // and the level that ran then was `prelim`. That level's SUCCESSOR is the Global preliminary search —
  // the clearance a request with nothing named resolves to — so it is the one that stays silent, and
  // `sigLevel`'s default reads a suffixless row as it. The key name stays `level:` for the same reason:
  // it is a string already written into every ledger on disk.
  return lvl && lvl !== BASELINE_PRODUCT ? `${base}|level:${lvl}` : base;
}
/** The product a suffixless signature carries. Every pre-spine ledger row is one, exactly: only the
 *  clearance that is now the Global preliminary search could run before the spine. */
const BASELINE_PRODUCT = "global-preliminary-search";
// The product a signature carries. Used by BOTH dedup dimensions below.
function sigLevel(sig) { return String(sig ?? "").match(/\|level:([^|]*)$/)?.[1] || BASELINE_PRODUCT; }

// Ledger path is OUTSIDE the queue dir (dirname(qdir)) so it never matches the *.json claim glob.
// IMPORTED, not declared here: the portal's pre-check and the MCP preview must compute the same
// path as this wall, and a second correct copy is how the first one drifted. usage-ledger.mjs is the
// leaf — it can be pulled into a request path, this module cannot — so the shared calculation lives
// there and the direction of the import is one-way on purpose.
function readMatterLedger(qdir) {
  try {
    return readFileSync(matterLedgerPath(qdir), "utf8").split("\n").filter(Boolean)
      .map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  } catch { return []; }
}
// A prior run within the window from a DIFFERENT message that matches EITHER the matter signature OR the
// email thread (conversationId) — but the THREAD dimension additionally requires the MARK to agree. The
// THREAD dimension catches a reply whose re-derived matter drifted (a "please proceed" re-runs intake and
// the classes/customer can come out slightly different) — but the MARK stays put across an original and its
// reply, so it is the reliable discriminant: distinct marks forwarded in ONE thread (three TMP8729 marks in
// one email, 2026-07-03) are SEPARATE matters and must all run, not collapse on the shared conversationId.
// The SIGNATURE dimension catches the same matter forwarded in a separate thread. conversationId is
// best-effort — when absent (empty), only the signature dimension applies, so legacy jobs dedup exactly as
// before. When either mark is empty the thread match falls back to conv-only (conservative for legacy/
// markless ledger entries). Empty mark AND empty thread never dedup (markless jobs already fail validation;
// never collapse on an empty key). TRADEOFF: a mark *correction* in a proceed-reply (same thread, slightly
// different mark string) now runs twice — accepted vs. the production false-positive, and that case belongs
// in the §B5b late-bind, not a fresh enqueue.
function findDuplicateMatter(qdir, { sig, conversationId, msgId }, now) {
  if (DEDUP_WINDOW_MS <= 0) return null;
  const curMark = sig.split("|")[1] || "";
  const hasMark = Boolean(curMark);
  const conv = String(conversationId ?? "").trim();
  if (!hasMark && !conv) return null;
  // ── — WHAT `failed` MEANS HERE, AND WHAT A PARK MEANS ────────────────────
  //
  // `failed` is set in exactly one place, dropMatter, which MARKS rather than removes: the monthlyRuns
  // cap counts spend and a failed run spent, so deleting the row let a failing loop burn unlimited
  // quota. Two callers reach it — the run terminal under `if (!res.ok)`, and endClaimTerminal on the
  // reclaim-exhausted / already-delivered path.
  //
  // A PARK REACHES NEITHER, and that is deliberate rather than an oversight. `if (res.postponed)`
  // returns before the terminal block, so a parked leg's row stays un-failed and keeps blocking — which
  // is CORRECT while the park is live, because it auto-resumes and a second submission really is a
  // duplicate. It would only be wrong for a park that never resumes, and the abandonment routes are
  // covered: reclaim-exhausted goes through endClaimTerminal, and a cancel taken while parked now frees
  // the matter in retireCancelledPark (it was the one terminal writer that did not, so stopping the
  // same matter two seconds apart used to give two different answers about re-submitting it).
  //
  // So the rule a reader needs: an un-failed row inside the window means the matter is still LIVE
  // somewhere — running, or parked and due to resume. It does not mean "a run once started and we
  // stopped tracking it".
  for (const e of readMatterLedger(qdir)) {
    if (e.failed || e.msgId === msgId || (now - (e.ts ?? 0)) >= DEDUP_WINDOW_MS) continue;   // failed rows never block a re-send (they still count for the monthly cap)
    const priorMark = String(e.sig ?? "").split("|")[1] || "";
    const marksAgree = !curMark || !priorMark || curMark === priorMark; // conservative when either absent
    // Search-depth spine (review 2026-07-17): the THREAD dimension must be level-aware too — the headline
    // escalation is a SAME-thread reply ("knockout came back HIGH — run the full clearance"): same
    // conversationId, same mark, different level. A level change is never a duplicate, on either dimension.
    const levelsAgree = sigLevel(sig) === sigLevel(e.sig);
    if ((hasMark && e.sig === sig) || (conv && e.conversationId === conv && marksAgree && levelsAgree)) return e;
  }
  return null;
}
function recordMatter(qdir, entry) {
  try {
    // a crash re-claim re-enters claimAndPrep with the same msgId — never append a second row
    // (monthlyRuns would double-count; review 2026-07-18). Serial per queue, so the read is race-free.
    if (entry.msgId && readMatterLedger(qdir).some((e) => e.msgId === entry.msgId)) return;
    appendFileSync(matterLedgerPath(qdir), JSON.stringify(entry) + "\n");
  } catch (e) { note(`[runner] matter-ledger append failed (non-fatal): ${e?.message ?? e}`); }
}

// ── Per-account ADMISSION caps — `runCaps` on the customer profile, enforced
// at THIS chokepoint so every intake door (email, CLI, MCP, portal) is covered. HONEST BOUNDS
// (review 2026-07-18): counts are serial PER QUEUE, but drainQueue runs queues concurrently, so
// simultaneous same-account claims in two agents' queues can overshoot by a bounded 1-per-queue —
// acceptable in a clarify-not-drop gate. Counting is by the queued manifests' profileKey TAG: the
// portal/MCP door always tags, so the cost-bomb shape is fully bounded; untagged (email-door,
// domain-resolved) backlog is NOT counted — each untagged job is capped only as the in-hand job when
// admitted. Over-cap CLARIFIES (requester notified, re-sendable), never drops. Exported for tests.
// The default: a brand owner gets 20 client-started searches a day unless its profile says otherwise.
// A default rather than a per-profile entry because the risk it answers is a NEW account arriving with no
// runCaps block and therefore no ceiling at all — which is what every live profile looked like before this.
// A profile that sets dailyRuns overrides it; setting it to 0 is not "unlimited", it is zero.
//
// — 20, not the beta's 2. The 2 answered "an account with no ceiling at all" and
// answered it far past the point of being a ceiling: it refused a client on their third search of the day,
// which reads as the product being broken rather than as a fair-use wall. The risk this exists to stop is
// unbounded spend by an unconfigured account, and 20 stops that just as completely. It is the DEFAULT, so
// any account that needs a different number says so in its own runCaps block.
export const DEFAULT_CLIENT_DAILY_RUNS = 20;

export function checkRunCaps({ account, caps, queueDirs, inHandTagged = true, now = Date.now(), clientRun = false }) {
  // `generic` is the neutral no-customer profile and stays exempt: it is not a brand owner, and capping it
  // would put a ceiling on staff/email work that was never client-attributed.
  if (!account || account === "generic") return null;
  // The default applies to the DAILY allowance only. maxQueued/monthlyRuns stay opt-in per profile.
  const eff = Number.isInteger(caps?.dailyRuns) ? caps : { ...(caps ?? {}), dailyRuns: DEFAULT_CLIENT_DAILY_RUNS };
  caps = eff;
  const monthKey = new Date(now).toISOString().slice(0, 7);
  const dayKey = new Date(now).toISOString().slice(0, 10);
  if (Number.isInteger(caps.maxQueued)) {
    let queued = 0;
    for (const qd of queueDirs) {
      let files = [];
      try { files = readdirSync(qd).filter(isLiveQueueMarker); } catch { continue; }
      for (const f of files) {
        try { if ((JSON.parse(readFileSync(join(qd, f), "utf8")).profileKey ?? null) === account) queued++; }
        catch { /* mid-rename / prose sidecar — skip */ }
      }
    }
    // a TAGGED in-hand job (.processing) is already inside `queued`; an untagged-but-resolved one is
    // not, so it rides +1 on top — the threshold accounts for which shape we hold (review 2026-07-18:
    // the uniform +1 admitted untagged jobs one over the cap).
    const inFlight = queued + (inHandTagged ? 0 : 1);
    if (inFlight > caps.maxQueued) {
      return `admission cap: ${account} already has ${inFlight - 1} run(s) queued/in-flight (runCaps.maxQueued=${caps.maxQueued}) — wait for the backlog to drain or cancel one (stop_run), then re-send`;
    }
  }
  // dailyRuns — the beta allowance, and the ONLY cap that counts a subset of runs rather than all of
  // them. It bounds what a CLIENT can spend per day; staff acting for the same account are uncapped,
  // which is the owner's decision (2026-07-20) and the reason a firm can service a client who has
  // already used their own allowance.
  //
  // THE POLARITY IS THE WHOLE SAFETY ARGUMENT. `clientRun` is a POSITIVE stamp, set only where the
  // principal's role is authoritatively known to be "client" — portal-service, which is the only door
  // a client can reach at all. Absent ⇒ uncapped. Every alternative that infers the role here fails
  // DANGEROUSLY: `enqueuedBy` is the shared portal ops-token subject for client and staff alike;
  // `enqueuedVia` is identical for both; and `isFirmDomain(forwarderEmail)` reads the staff-domain list
  // from an env var the runner's unit does not carry — so on this process it is empty, every run looks
  // like a client run, and the cap lands on staff and the email door. Absence-means-uncapped fails in
  // the direction that never blocks legitimate work, and a client cannot reach a door that omits it.
  if (Number.isInteger(caps.dailyRuns) && clientRun) {
    let today = 0;
    for (const qd of queueDirs) {
      for (const e of readMatterLedger(qd)) {
        // A FAILED run does not consume the daily allowance (owner, 2026-07-20). The two caps answer
        // different questions and so count differently, deliberately:
        //   dailyRuns  — FAIRNESS. It exists so a beta client keeps coming back, not to control spend.
        //                Charging someone their day because our engine broke is the fastest way to lose
        //                them, and they cannot tell our fault from theirs.
        //   monthlyRuns — SPEND. It still counts failures (dropMatter marks the row `failed`, it never
        //                removes it) because a failed run did spend, and a failing loop that freed its
        //                own quota could burn without bound. That guard stays exactly where it was.
        // So a client whose runs keep failing is bounded by the MONTHLY cap, not the daily one — which
        // is why a monthlyRuns value is worth setting on any account this matters for.
        if (e.failed === true) continue;
        if (e.profileKey === account && e.clientPrincipal === true
          && typeof e.ts === "number" && new Date(e.ts).toISOString().slice(0, 10) === dayKey) today++;
      }
    }
    if (today + 1 > caps.dailyRuns) {
      return `daily allowance: ${account} has started ${today} search(es) today (runCaps.dailyRuns=${caps.dailyRuns}) — the allowance resets at midnight UTC, or ask your ${BRAND.name} contact to run this one for you`;
    }
  }
  if (Number.isInteger(caps.monthlyRuns)) {
    let month = 0;
    for (const qd of queueDirs) {
      for (const e of readMatterLedger(qd)) {
        if (e.profileKey === account && typeof e.ts === "number" && new Date(e.ts).toISOString().slice(0, 7) === monthKey) month++;
      }
    }
    if (month + 1 > caps.monthlyRuns) {
      return `admission cap: ${account} has started ${month} run(s) this month (runCaps.monthlyRuns=${caps.monthlyRuns}) — the cap resets at month end; raise it in the customer profile if this is intended growth`;
    }
  }
  return null;
}
// A FAILED run must not block a genuine re-send of the same matter → drop its ledger entry (atomic rewrite).
function dropMatter(qdir, msgId) {
  try {
    // MARK failed, never remove (review 2026-07-18): the DEDUP gate must free (a genuine re-send of a
    // failed matter must run — findDuplicateMatter skips failed rows), but the monthlyRuns cap counts
    // SPEND, and a failed run spent — deleting the row let a failing loop burn unlimited quota.
    const rows = readMatterLedger(qdir).map((e) => (e.msgId === msgId ? { ...e, failed: true } : e));
    const p = matterLedgerPath(qdir);
    writeFileSync(`${p}.tmp`, rows.map((e) => JSON.stringify(e)).join("\n") + (rows.length ? "\n" : ""));
    renameSync(`${p}.tmp`, p);
  } catch (e) { note(`[runner] matter-ledger drop failed (non-fatal): ${e?.message ?? e}`); }
}

// Exported for unit tests (the integration path exercises them via claimAndRun).
export { matterSignature, matterLedgerPath, findDuplicateMatter, recordMatter, dropMatter, readMatterLedger };

// Best-effort intake-reject notice. The silent-intake failure mode (live slogan-mark matter, 2026-06-10): a
// job that dies at validation never reaches pipeline(), so no run-level failure event fires and the
// requester hears nothing. This is the runner-side backstop: the rejection rides the outbox as a
// self-contained event packet — no gateway, no messaging binary, no run dir needed. NEVER throws; the
// .failed markers are written BEFORE this runs, so a notify failure can never lose the rejection
// record. Returns the audit-trail outcome string appended to the .reason file (`notify: <outcome>`).
async function intakeNotify(agentId, base, job, v) {
  // plain optional chaining throughout: `Array.isArray(x) && ...` yields boolean false (NOT nullish) when
  // marks is absent, which would swallow the `?? base` fallback in exactly the null-job case it exists for.
  const mark = job?.markName ?? job?.name ?? job?.marks?.[0]?.name ?? base;
  const what = v?.classify === "clarify"
    ? `needs clarification before it can run: ${v.errors.join("; ")}`
    : `was rejected at intake: ${(v?.errors ?? ["unparseable job file"]).join("; ")}`;
  const text = `⚠️ Prelim request "${mark}" ${what}. Nothing has been searched or delivered. ` +
    `Job parked as ${base}.failed in the ${agentId} queue.`;
  const p = writeOutboxPacket(`intake-${base}.failed`, {
    kind: "intake-rejected", classify: v?.classify ?? "reject", base, agent: agentId,
    jobId: job?.id ?? null, msgId: job?.msgId ?? null,
    forwarder: job?.forwarder ?? null, forwarderEmail: job?.forwarderEmail ?? null,
    markName: (job?.markName ?? job?.name ?? job?.marks?.[0]?.name) || null,
    errors: v?.errors ?? ["unparseable job file"], text,
  });
  return p ? `packet ${p}` : "packet-failed";
}

// Sweep a consumed claim's sidecars (.pid liveness token, .meta run identity, .skips in-flight tally) once
// the .processing marker is renamed away — keyed by the claim path, best-effort. A leftover
// `.processing.meta` would keep its codename in queueOwnedCodenames forever and block the run-dir orphan
// self-resume for that run.
function cleanupClaimSidecars(procPath) {
  for (const suffix of CLAIM_SIDECAR_SUFFIXES) {
    try { rmSync(`${procPath}${suffix}`, { force: true }); } catch { /* best-effort */ }
  }
}

/**
 * — move a claimed marker to its terminal state, tolerating a marker a sibling already moved.
 *
 * Every one of these renames is the LAST thing done to a marker: the job is over (done / failed /
 * cancelled / duplicate / parked), or it is being handed back to the queue. If the marker is already gone,
 * the outcome this call wanted is the outcome on disk — there is nothing to repair and nothing to report.
 *
 * It threw before, and the throw was worse than useless. In the takeover race the reproduction shows the
 * winner's terminal rename hitting a marker a sibling had already moved: `ENOENT ... rename
 * job-race.processing -> job-race.json`, swallowed by the drain's `Promise.allSettled` so the process
 * still exited 0. So the one signal that two runners had collided over a live job was raised as an
 * exception, thrown away by the collector, and the run reported success. An absence here is genuinely not
 * a finding — but it must be a DELIBERATE absence, said once, not an error that happens to be discarded.
 *
 * Returns true when this call moved the marker, false when it was already gone. Any other error still
 * throws: a permissions failure or a full disk is not a sibling.
 */
export function retireMarker(procPath, destPath, what = "") {   // exported for 's honesty test
  try { renameSync(procPath, destPath); return true; }
  catch (e) {
    if (e?.code !== "ENOENT") throw e;
    // — SAY WHAT HAPPENED, NOT WHAT WAS WANTED. This read "leaving <dest>", which asserts that
    // <dest> is on disk. On this branch the rename did NOT happen, so <dest> was never created by this
    // call, and the parenthetical named the outcome the caller intended rather than the one an operator
    // would find. It is the single line an operator reads to discover where a job went, and it was
    // pointing at a file that is not there. The reproduction (, PR) ends with the queue dir
    // holding `job-race.processing` and `job-race.processing.pid` and NO `.json` at all, under a log
    // line that said the orphan had been returned to the queue.
    note(`[runner] ${basename(procPath)} was already retired by another runner — this call did NOT create ${basename(destPath)} (it wanted: ${what || "retire the marker"}); the marker is in whatever state that runner left it`);
    return false;
  }
}

/**
 * — retire a claim THIS runner holds and sweep its sidecars as ONE operation, under the claim lock.
 *
 * What this replaces is `retireMarker(...)` followed UNCONDITIONALLY by `cleanupClaimSidecars(procPath)`,
 * where the sweep outlived the claim. The sidecars are keyed by PATH, not by claim, so once the retire
 * rename LOSES — ENOENT, because a sibling is inside `takeoverClaim`'s two-rename window and the marker
 * is off disk — the files the loser goes on to delete are the ones that sibling is in the middle of
 * writing:
 *
 *   A: rename .processing -> .json           ENOENT — B holds the lock, the marker is not there
 *   A: rm .processing.pid                    A deletes the liveness token…
 *   B: reads .pid under its lock -> ABSENT   …which IS the dead-claim signal B reads, so B stops
 *                                            standing down against A's live token and WINS the takeover
 *   B: stamps .pid = B, restores .processing
 *   A: rm .processing.meta, .skips           A deletes the bookkeeping of the claim B now owns
 *
 * The loser does not merely delete a live claim's files — its first delete MANUFACTURES the condition
 * that hands the claim to someone else. And a `.processing` with no `.meta` is B1's disaster: the next
 * activation's orphan scan finds no codename, mints a fresh one over a perfectly resumable run and
 * re-buys every completed stage. A `.processing` with no `.pid` is worse — the next runner's takeover
 * wins against a live claimer and the job dispatches twice.
 *
 * A guard in front of the sweep does not fix this: any "do I still hold it?" READ is separated from the
 * `rm` by a window the sibling can win. So use the codebase's own claim idiom — THE RENAME IS THE
 * LOCK. The marker moves to a token-named `.claimed-` path first and the retire happens FROM there, so
 * the sidecars are deleted while the marker is invisible to every queue scan and no other runner can
 * form a claim on this base. Losing that first rename IS losing the claim: nothing is deleted, nothing
 * is retried (a retry would either lose the same race again or steal a marker the winner is mid-way
 * through restoring), and the next activation re-claims the orphan on its own merits.
 *
 * WHAT THE LOCK EXCLUDES, and the precondition a future caller inherits: every claim site must first win
 * a rename on a marker that is not there — `takeoverClaim` on `.processing`, `claimDuePostponed` on
 * `.postponed`. `claimAndPrep` is the one that enters from `<base>.json` and so never touches the
 * marker; the argument holds only because no `<base>.json` exists while we hold the lock (both enqueue
 * doors refuse an id whose `.json` or `.processing` is already present, and this call is the one about
 * to create it). The residual — a fresh enqueue of the SAME id landing between the two renames — is the
 * window 's claim lock and `takeoverClaim` already carry, unchanged here. At a call site where a
 * `<base>.json` CAN coexist with the marker, that argument does not transfer.
 *
 * Returns true when this call moved the marker to `destPath`. False means the claim was not ours to
 * retire — and that nothing on disk was touched.
 */
export function retireClaimAndSweep(procPath, destPath, what = "", { token = claimToken() } = {}) {   // exported for 's race test
  const lockPath = `${procPath}.claimed-${token}`;
  try { renameSync(procPath, lockPath); }
  catch (e) {
    if (e?.code !== "ENOENT") throw e;
    note(`[runner] ${basename(procPath)} is no longer ours to retire — another runner holds the marker; this call did NOT create ${basename(destPath)} (it wanted: ${what || "retire the marker"}) and deleted none of its sidecars`);
    return false;
  }
  // Under the lock the `.pid` cannot change, so this read and the sweep below are one operation. An
  // ABSENT sidecar PROCEEDS: nothing covers this marker — that is exactly the legacy sidecar-less orphan
  // this path exists to hand back to the queue — and no claim can form while we hold the lock. Refusing
  // on absence would strand those orphans as `.processing` forever, which is the state they are already
  // in. A sidecar carrying SOMEONE ELSE'S token is a claim we do not own: stand down rather than steal.
  let covering = null;
  try { covering = readFileSync(`${procPath}.pid`, "utf8").trim(); } catch { /* no sidecar — legacy claim */ }
  if (covering && covering !== token) {
    note(`[runner] ${basename(procPath)} is covered by another runner's claim token (${covering}), not ours — standing down: not retiring it, not deleting its sidecars`);
    try { renameSync(lockPath, procPath); } catch { /* sweepAbandonedTakeovers restores it */ }
    return false;
  }
  cleanupClaimSidecars(procPath);
  return retireMarker(lockPath, destPath, what);
}

/**
 * — the TERMINAL half of a reclaim, for the two branches of `reclaimOrphanedClaims` that end a job
 * outright: "already delivered" (.done) and "reclaim exhausted" (.failed). Both were the same five steps,
 * and all FOUR after the rename ran whatever the rename did:
 *
 *     retireMarker(procPath, `${base}.done`, …);   // may return false — the marker was not ours
 *     cleanupClaimSidecars(procPath);              // ← ran anyway
 *     cleanupProseParts(qdir, base);               // ← ran anyway
 *     writeFileSync(`${base}.done.result`, …);     // ← ran anyway
 *     dropMatter(qdir, job.msgId);                 // ← ran anyway (reclaim-exhausted only)
 *
 * A false return now MEANS "nothing on disk was touched and the claim is not ours". `retireClaimAndSweep`
 * already puts the sidecar sweep behind that; the other three have to sit behind it here, and each is a
 * distinct harm when it does not:
 *
 *   - `cleanupProseParts` deletes the base-keyed prose (`.markName.md`, `.brief.md`, …) that a job is
 *     RE-ASSEMBLED from. It is the one deletion that outlives every marker state: the winner's job — a
 *     resume, or a hand-back to `.json` — then cannot be assembled at all.
 *   - `<base>.done.result` / `<base>.failed.result` asserts a terminal that is not on disk. That is
 *     's defect exactly (a line naming the outcome the caller WANTED, not the one an operator would
 *     find), one call below the fix for it.
 *   - `dropMatter` marks the matter ledger row `failed`, and `findDuplicateMatter` skips failed rows —
 *     so it re-opens the dedup gate for a matter the winner may be mid-resume, and the ~$40 duplicate
 *     search that gate exists to refuse now runs.
 *
 * Ordering is NOT touched. Each caller's bookkeeping — the delivered branch's `armUnannouncedDelivery`,
 * the exhausted branch's failure packet — stays BEFORE this call, where its own comment requires it:
 * retiring first would open a crash
 * window that leaves a `.failed` marker with no notice on any lane, the silent stall T5 forbids.
 * The residual that leaves is stated at the call site and is older than this function.
 *
 * Returns what `retireClaimAndSweep` returned: true when this call ended the job.
 */
export function finishReclaimedClaim(procPath, qdir, base, state, what, result, { dropMsgId = null } = {}) {
  if (!retireClaimAndSweep(procPath, join(qdir, `${base}.${state}`), what)) {
    note(`[runner] ${base} was NOT ended as .${state} by this activation — another runner holds the claim; its prose parts, its .result and its matter-ledger row are left exactly as they are, and the winner decides this job's outcome`);
    return false;
  }
  cleanupProseParts(qdir, base);
  try { writeFileSync(join(qdir, `${base}.${state}.result`), JSON.stringify(result, null, 2) + "\n"); } catch { /* best-effort */ }
  if (dropMsgId != null) dropMatter(qdir, dropMsgId);
  return true;
}

// Park a claimed job as rate-limit POSTPONED. ORDER IS LOAD-BEARING (B1's crash invariant — never a
// fresh codename over a resumable run): the identity-carrying `.postponed.meta` lands FIRST (atomic
// tmp+rename, a torn meta would fail-open into a fresh mint), and only then the marker rename +
// cleanupClaimSidecars (which removes `.processing.meta`). The old order (rename → cleanup → meta
// write) had a window where the ONLY durable copy of the codename was gone: a SIGKILL there left a
// bare `.postponed` whose fail-open resume minted a fresh codename and re-bought every completed
// stage — while a surviving run-dir `.postponed` sentinel could ALSO self-resume the old codename
// (no longer queue-owned) → two parallel runs of one matter. Exported for the ordering test.
export function parkPostponed(procPath, qdir, base, data) {
  const metaPath = join(qdir, `${base}.postponed.meta`);
  writeFileSync(`${metaPath}.tmp`, JSON.stringify(data, null, 2) + "\n");
  renameSync(`${metaPath}.tmp`, metaPath);
  // NOT retireMarker: an absent marker here is not a sibling that beat us to it — a park happens under a
  // claim this runner holds, and is precisely what makes that claim unstealable. The throw is also
  // the crash-window probe runner.postpone-identity.test.mjs injects to prove the meta lands first.
  renameSync(procPath, join(qdir, `${base}.postponed`));
  cleanupClaimSidecars(procPath);
}

// ── B2 — fail-safe claim liveness, now shared ────────────────────────────────────────────────────────
// These moved to driver/claim-liveness.mjs and are re-exported here so every existing importer and test
// keeps working unchanged. They moved because scripts/purge-runs.mjs — the tool that DELETES — needs the
// same answer and cannot import the runner. The alternative was a second copy of "is this claimer alive"
// on the one path in the tree that destroys bytes; that file's header has the full argument.
// Imported AND re-exported: a bare `export ... from` would not bind these names in this module's scope,
// and `claimToken` below calls `procStarttime` directly.
import { procStarttime, parseClaimSidecar, claimAgeMs, claimerIsAlive } from "./claim-liveness.mjs";
import { isEntrypoint } from "../shared/is-entrypoint.mjs";   // — one entry-point test, all spellings
import { beat } from "./worker-heartbeat.mjs";   // — is anything draining this install
import { BRAND } from "../shared/brand.mjs";   // — the operator name in the allowance note, from the tenant seam
export { procStarttime, parseClaimSidecar, claimAgeMs, claimerIsAlive };

// — a queue running WITHOUT the birth stamp says so, once, out loud. Where no stamp can be read
// (WSL1, a container with no procfs and no `ps`) every token below silently degrades to the bare pid this
// defence was built to replace, and nothing in the runner's output distinguished that from the defence
// working. macOS left this list, when procStarttime gained a `ps` reader.
// Once per process, because it is a property of the machine and not of the job: a per-claim line would
// be noise the operator learns to scroll past, which is the same as not printing it.
let starttimeGapAnnounced = false;

export function claimToken(pid = process.pid) {
  const st = procStarttime(pid);
  if (!st && !starttimeGapAnnounced) {
    starttimeGapAnnounced = true;
    note("[runner] no birth stamp for this pid on this host — neither /proc/<pid>/stat nor `ps` " +
      "answered, so claims record a BARE PID and the #665 PID-reuse " +
      "defence is inactive. Fail-safe direction (a claim whose liveness cannot be proved counts as " +
      "ALIVE): no run is ever double-claimed and no lawyer double-delivered to. What is lost: a " +
      "`.processing` held by a RECYCLED pid is not freed by liveness and waits for the max-claim-age " +
      "ceiling instead. Linux and macOS both supply the stamp — README.md, 'Where it runs'.");
  }
  return st ? `${pid}:${st}` : String(pid);
}


// Park a claimed job as terminally failed-at-intake: consume the .processing claim (else drainQueue re-claims
// it as .json on the next 90s tick and it re-fails FOREVER — the leak the unparseable branch used to have),
// record the reason, ping the requester, and append the ping outcome to the reason file for the audit trail.
async function failAtIntake(procPath, qdir, base, agentId, job, v, reasons) {
  retireMarker(procPath, join(qdir, `${base}.failed`), "failed at intake");
  cleanupClaimSidecars(procPath);
  cleanupProseParts(qdir, base);
  writeFileSync(join(qdir, `${base}.failed.reason`), reasons.join("\n") + "\n");
  const notified = await intakeNotify(agentId, base, job, v);
  try { appendFileSync(join(qdir, `${base}.failed.reason`), `notify: ${notified}\n`); } catch { /* best-effort */ }
}

// Best-effort duplicate-skip notice (mirrors intakeNotify: one outbox packet). Returns the audit-trail
// outcome string for the .reason file.
async function duplicateNotify(agentId, base, job) {
  const mark = job?.markName ?? job?.name ?? job?.marks?.[0]?.name ?? base;
  const text = `⚠️ Prelim request "${mark}" looks like a duplicate of a matter already in progress or just delivered — ` +
    `skipped to avoid a second search. The original run will deliver. Tell me if you genuinely need a fresh run.`;
  const p = writeOutboxPacket(`intake-${base}.duplicate`, {
    kind: "duplicate-skipped", base, agent: agentId,
    jobId: job?.id ?? null, msgId: job?.msgId ?? null,
    forwarder: job?.forwarder ?? null, forwarderEmail: job?.forwarderEmail ?? null,
    markName: (job?.markName ?? job?.name ?? job?.marks?.[0]?.name) || null, text,
  });
  return p ? `packet ${p}` : "packet-failed";
}

// Park a claimed job as a DUPLICATE: consume the .processing claim (so the 90s timer never re-claims it),
// record why, ping the forwarder once. Recoverable — re-enqueue with "dupOverride": true to force a genuine
// re-run (a bare .duplicate -> .json rename re-matches the prior within the dedup window and re-parks).
async function parkDuplicate(procPath, qdir, base, agentId, job, prior, sig) {
  renameSync(procPath, join(qdir, `${base}.duplicate`));
  cleanupClaimSidecars(procPath);
  cleanupProseParts(qdir, base);
  const conv = String(job.conversationId ?? "").trim();
  const matchedBy = prior.conversationId && prior.conversationId === conv ? "thread (conversationId)" : "matter signature";
  const reason = [
    `duplicate prelim — not run (a second search for the same matter)`,
    `matched by: ${matchedBy}`,
    `matter: ${sig}`,
    `conversationId: ${conv || "-"}`,
    `matches prior msgId ${prior.msgId} (recorded ${new Date(prior.ts).toISOString()}, within ${DEDUP_WINDOW_MS / 3600000}h)`,
    `to force a genuine re-run, re-enqueue with "dupOverride": true (a bare ${base}.duplicate -> ${base}.json rename re-matches the prior within the ${DEDUP_WINDOW_MS / 3600000}h window and re-parks)`,
  ].join("\n");
  writeFileSync(join(qdir, `${base}.duplicate.reason`), reason + "\n");
  const notified = await duplicateNotify(agentId, base, job);
  try { appendFileSync(join(qdir, `${base}.duplicate.reason`), `notify: ${notified}\n`); } catch { /* best-effort */ }
}

// Best-effort pre-run failure notice — the no-run-dir arm of the B3 backstop below. A pipeline throw
// BEFORE the run dir exists (e.g. a dropped register credential caught by preflightCredentials) leaves
// no RUN-level packet lane, because the run-level packet is written into the run dir that does not
// exist. It rides the QUEUE-level lane instead, exactly like its two siblings above.
//
// — THIS USED TO BE THE ONE UN-GATED SPAWN LEFT IN THE PRODUCT. Its three siblings each carried a
// `deliveryMode !== "stage"` branch that took the outbox in the headless default; this one had no such
// branch, only `if (!AGENT_WHATSAPP[agentId])`. So on a deployment with a messaging roster bound it
// spawned an integrator platform's binary on the pre-run-failure path whatever the delivery mode said,
// and the notice was LOST on every deployment without that platform installed — which is every
// deployment of this product. Re-routing it rather than deleting it keeps the notice the B3 backstop
// exists for: a failure before the run owns a directory is precisely the one nothing else reports.
//
// `whatsappTo` is a ROUTING KEY in the packet, not a send: the integrator owns the sending, and the
// run-level failure packet has carried the same field since the outbox was written.
//
// NEVER throws; the .failed markers are written before this runs. Returns true when a packet landed.
function preRunFailNotify(agentId, base, job, reason) {
  const mark = job?.markName ?? job?.name ?? job?.marks?.[0]?.name ?? base;
  // — the ONE capping function, not a second private copy. Its only caller already hands over a
  // terminalReasonFields `reason`, so this cut is a no-op today — which is exactly why it survived: a
  // latent second cap, unmarked, waiting for the next caller to pass a raw reason. It collapses and
  // trims identically, so this is the same string with the cut made visible when there is one.
  const text = `❌ Prelim request "${mark}" FAILED before the run could start: ${terminalReasonFields(reason).reason} — ` +
    `nothing has been searched or delivered. Job parked as ${base}.failed in the ${agentId} queue.`;
  // `intake-${base}.` PREFIX, not a third scheme: scripts/e2e.mjs's outboxPackets matches by runId
  // first and by that prefix second, so a name outside it is a notice the harness reports as
  // never sent. The queue base is the routing key; `kind` carries what actually happened.
  const p = writeOutboxPacket(`intake-${base}.prerun-failed`, {
    kind: "pre-run-failed", base, agent: agentId,
    jobId: job?.id ?? null, msgId: job?.msgId ?? null,
    forwarder: job?.forwarder ?? null, forwarderEmail: job?.forwarderEmail ?? null,
    markName: (job?.markName ?? job?.name ?? job?.marks?.[0]?.name) || null,
    whatsappTo: AGENT_WHATSAPP[agentId] ?? null,
    reason: terminalReasonFields(reason).reason, text,
  });
  note(`[runner] pre-run failure ${p ? `packet \u2192 ${p}` : "packet write FAILED"} for ${base}`);
  return Boolean(p);
}

// B3 — guaranteed failure-notice backstop for PRE-TRY throws. pipelineInner's run-level catch owns every
// failure inside its try{} (it RETURNS {ok:false, failedStage, …} after notifying — the
// _driver/failure.json + outbox packet); a throw that reaches runPrepared's catch instead (res.failedStage
// unset) came from the SETUP code before that try — corrupt profile sidecar, missing framework manifest,
// dropped register credential, resume-refused, pathological mark — which used to produce a silent .failed
// with no requester notice (a dropped credential would silently fail every queued run at once). Write the
// SAME packet + outbox marker the pipeline catch writes into the run dir when one exists; with no run dir
// at all, fall back to the QUEUE-level packet above (`intake-<base>.prerun-failed`). Guards: an existing failure.json means the notice
// already exists (never double-notify); a .delivered run already gave the lawyer a report (a failure
// notice for a refused resume of it would only confuse). NEVER throws.
async function backstopFailureNotice({ res, job, agentId, base, codename, studioRoot, archiveRoot }) {
  try {
    // `res.cancelled` is named explicitly rather than left to ride on failedStage: a stop IS handled by
    // the pipeline's own catch, and a backstop notice for it would tell someone who pressed Stop that
    // their run failed "pre-run".
    if (res.ok || res.postponed || res.cancelled || res.failedStage != null) return;   // the pipeline's own catch handled it
    const reason = String(res.reason ?? "unknown pre-run failure");
    // — the SAME three fields the pipeline's terminal writes carry. This used to cut at 200 and
    // say nothing about the cut, so a pre-run failure whose cause sat past character 200 left
    // status.json holding a sentence that stopped mid-thought, with no key to say it had been stopped.
    const { reason: shortReason, reasonTruncated, reasonFull } = terminalReasonFields(reason);
    const slug = deriveSlug(job);
    const owned = codename ? findRunDirFor({ codename, slug, studioRoot, archiveRoot }) : null;
    if (!owned) { preRunFailNotify(agentId, base, job, shortReason); return; }
    if (owned.kind === "archived" || existsSync(join(owned.dir, ".delivered"))) return;   // report already delivered
    if (existsSync(driverDir(owned.dir, "failure.json"))) return;                   // already noticed
    const packet = buildFailurePacket({
      // canonical runId form (charter P1 §3): `<slug>-<date>-<codename>` — owned.dir's leaf IS
      // "<date>-<codename>", so the dated id is derivable even here (matches status.runId + rescan).
      runId: `${slug}-${basename(owned.dir)}`, agent: agentId, job, failedStage: "pre-run",
      shortReason, reasonVerbatim: reason.slice(0, 1000), whatsappTo: AGENT_WHATSAPP[agentId] ?? null,
    });
    // same per-send invariant as the pipeline's failure path: a fresh notice supersedes an older .sent
    // and its per-channel receipts (B4 — stale receipts would make prelim-deliver skip this notice)
    try { rmSync(join(owned.dir, ".sent"), { force: true }); } catch { /* none */ }
    try { rmSync(driverDir(owned.dir, "send-receipts.json"), { force: true }); } catch { /* none */ }
    ensureDriverDir(owned.dir);
    writeFileSync(driverDir(owned.dir, "failure.json"), JSON.stringify(packet, null, 2) + "\n");
    // status flip mirrors the pipeline path (best-effort — packet + marker are the guaranteed lane)
    try {
      const sp = join(owned.dir, "status.json");
      const s = JSON.parse(readFileSync(sp, "utf8"));
      writeFileSync(sp, JSON.stringify({ ...s, state: "failed", failedStage: "pre-run", reason: shortReason, reasonTruncated, reasonFull, sendPending: true }, null, 2) + "\n");
    } catch { /* a pre-seed throw leaves no status.json — the packet still notifies */ }
    mkdirSync(config.outboxDir, { recursive: true });
    writeFileSync(join(config.outboxDir, `${packet.runId}.pending`), `${agentId}\n`);
    note(`[runner] pre-run failure notice (backstop): _driver/failure.json + outbox marker for ${packet.runId}`);
  } catch (e) {
    note(`[runner] failure-notice backstop failed (non-fatal — .failed + .failed.result remain the record): ${e?.message ?? e}`);
  }
}

// Claim one job from queue dir `qdir` and run it as `agentId`. Markers stay in `qdir` (the origin queue).
// CHEAP, SERIAL half: atomic claim → assemble → validate → matter-dedup → record. drainQueue runs this
// one-at-a-time so the dedup check+record stays race-free even while prior jobs' pipelines run concurrently
// (Phase-4). Returns the prepared {procPath, base, job} to execute, or null when the job was terminally
// parked/failed-at-intake, or the claim was lost.
async function claimAndPrep(jsonFile, qdir, agentId) {
  const base = jsonFile.replace(/\.json$/, "");
  const procPath = join(qdir, `${base}.processing`);
  // — THE CLAIM AND ITS LIVENESS TOKEN ARE ONE OPERATION.
  //
  // This used to rename `.json` → `.processing` and then stamp `.pid`. Between those two syscalls a live,
  // claimed job sat on disk with no liveness token, and both guards that should have protected it read the
  // absent sidecar as `rec = null` — the in-flight skip (`rec && claimerIsAlive(rec)`) and the re-verify
  // under the takeover lock (`!overAge && rec && isAlive(rec)`). So a takeover won against a live claimer,
  // the no-meta branch renamed the job back to `.json`, and it dispatched a second time under a fresh
  // codename. Reproduced: a duplicate run reached DELIVERED and archived while the queue recorded a
  // terminal `.failed` for the same job — a second billable search and a second report to the lawyer, for
  // one instruction.
  //
  // Claim through a token-named lock instead, exactly as takeoverClaim does one screen down: while the
  // marker wears the lock name it is invisible to every queue scan, so the sidecar can be written before
  // the marker is published. `.processing` now never exists without its `.pid`. Losers fail the first
  // rename and never touch the shared sidecar path — which is why this is not "write the sidecar first":
  // two runners both writing `<base>.processing.pid` would leave the loser's token covering the winner's
  // claim, and the same hole reopens the moment that loser exits.
  //
  // A crash between the two renames leaves `<base>.processing.claimed-<token>`, which
  // sweepAbandonedTakeovers already restores and the idle fast-path already counts as work. No new
  // machinery, and one recovery path rather than two.
  const token = claimToken();
  const lockPath = `${procPath}.claimed-${token}`;
  try {
    renameSync(join(qdir, jsonFile), lockPath); // atomic claim — only one runner wins
  } catch {
    return null; // another runner won the claim, or it vanished
  }
  // WS-C: record the claimer so the crash-recovery re-claim is LIVENESS-gated — a manual runner
  // started during a live systemd drain must never rename an in-flight job back to .json and re-run
  // it concurrently under a fresh codename (full re-spend; the duplicate would also collide as the
  // same agent). B2: the token is "<pid>:<starttime>" so a recycled pid can't impersonate this claim.
  //
  // NOT best-effort any more, and written tmp-then-rename. A swallowed failure here produced the same
  // sidecar-less `.processing` the lock exists to prevent, and a partial write produced an UNPARSEABLE
  // one — which is worse than the race, because `parseClaimSidecar` returns null for it permanently
  // rather than for a few microseconds. If the claim cannot be covered, it is not taken: restore the job
  // and let the next tick have it.
  try {
    writeFileSync(`${procPath}.pid.tmp`, token);
    renameSync(`${procPath}.pid.tmp`, `${procPath}.pid`);
  } catch (e) {
    note(`[runner] ${base} claim ABANDONED — could not write the liveness token (${e?.message ?? e}); returning it to the queue rather than running it uncovered`);
    try { rmSync(`${procPath}.pid.tmp`, { force: true }); } catch { /* best-effort */ }
    try { renameSync(lockPath, join(qdir, jsonFile)); } catch { /* the sweep restores it as .processing, then crash-recovery frees it */ }
    return null;
  }
  renameSync(lockPath, procPath);   // publish, already covered
  let job;
  try {
    job = assembleJob(procPath, qdir, base); // scalar manifest (JSON) + raw prose sidecars — only the manifest can throw
  } catch (e) {
    note(`[runner] unparseable manifest ${base}: ${e.message}`);
    await failAtIntake(procPath, qdir, base, agentId, null, null, [`unparseable manifest: ${e.message}`]);
    return null;
  }
  // atClaim: this job was already accepted at intake. Re-validation here catches a manifest that has since
  // become unrunnable, but it must not apply rules whose whole point is to gate NEW requests — archiving a
  // project would otherwise kill a job that had been sitting in the queue legitimately.
  const v = validateJob(job, { atClaim: true });
  // "with defaults" was accurate while every warning here was a proceed-with-default choice. adds
  // one that is not — a field no door declares, which is a fact about the manifest rather than a default
  // this run picked — and a line that mislabels its own contents is how a real signal gets read past.
  if (v.warnings?.length) note(`[runner] ${base} proceeding, with warnings: ${v.warnings.join("; ")}`);
  if (!v.ok) {
    note(`[runner] invalid job ${base} (${v.classify}): ${v.errors.join("; ")}`);
    await failAtIntake(procPath, qdir, base, agentId, job, v, v.errors);
    return null;
  }
  // Search-depth spine — resolve WHICH product shape this job selects (job selector → project/customer
  // default → house prelim), then gate on what this deployment can actually run. A selection that cannot
  // run here CLARIFIES loudly (parked + requester notified) — it must never silently run as a different-
  // priced product, and never silently drop. Fail-open discipline (review 2026-07-17): infra trouble may
  // NO FAIL-OPEN LEFT ON THIS PATH, and its removal is the point. It used to fall back to the literal
  // level `prelim` when resolution errored and the job "provably" wanted a plain clearance — but `prelim`
  // named THREE products depending on where it pointed, so the fallback was a guess wearing a level key:
  // an account whose defaults hold one country would have run a Full country search, case law and all,
  // off a config read that failed. Under the offering the product is a function of the scope, and a scope
  // we could not resolve names no product. A resolution that errors CLARIFIES — the job parks, the
  // requester is told, and nothing is spent on a search nobody chose.
  let policy;
  let effProfile = null;   // the resolved effective profile, hoisted for the runCaps gate + ledger stamp below
  let effScope = null;     // the resolved scope, hoisted so the rules below measure what the run will have
  {
    let profile = null, profileErr = null;
    try { ({ profile } = resolveEffectiveProfile(job)); effProfile = profile; } catch (e) { profileErr = e; }
    try {
      const recipes = job.recipeKey ? loadRecipes({ force: true, proseGuard: recipeProseGuard }) : null;   // live store, D1-guarded — a hand-committed recipe can't smuggle rating prose
      if (profileErr) throw profileErr;
      // ONE sequencing of the two resolutions, shared with every preview door (resolve-request.mjs), so
      // the product the wall admits is the product the plan step named.
      const r = resolveRequest(job, { profile, recipes });
      policy = r.resolved;
      effScope = r.scope;
    } catch (e) {
      const why = String(e?.message ?? e).slice(0, 160);
      policy = { clarify: `the requested search could not be resolved (${why}) — re-request, or omit product/recipeKey to run the account's own default` };
    }
  }
  // ── DEMO DATA NEVER STARTS A REAL CLEARANCE ────────────────────────────────
  //
  // AT THE WALL, NOT AT A DOOR. The doors are fail-open by their own doctrine — a profile store this
  // process cannot read must not stop somebody starting a search — so a check placed only there reports
  // a pass on exactly the resolution failure it is meant to catch. This is the chokepoint every path
  // reaches: portal, MCP, CLI and the dev cockpit all arrive at claimAndPrep.
  //
  // KEYED ON STARTING A CLEARANCE, NOT ON RESOLVING THE PROFILE. Putting it in resolveEffectiveProfile
  // would have been one line and would have broken the demo: seeding, replay and republishing all
  // resolve profiles for branding and framework, and none of them starts a run. Publishing a frozen
  // report is not a clearance.
  //
  // REJECT, NOT CLARIFY. Clarify means "re-send and it can proceed", and the requester cannot fix this
  // — the account itself is fiction. Rejecting says so instead of inviting a second attempt that will
  // fail identically.
  // — AGREEMENT, in both directions. The profile decides whether the account is
  // fiction and stays non-overlayable; the job's `demoRun` is the requester CONSENTING to that, never
  // changing it. A demo account with a demo run is the one honest combination; a demo account with an
  // ordinary job stays refused in the words this wall has always used; and a REAL account with a demo run
  // is refused too — a demo banner over a real report is the same untruth pointing the other way, and
  // worse, because the reader has every reason to trust it.
  const demoAgreement = demoRunAgreement({
    demoRun: job?.demoRun === true,
    demoData: effProfile?.demoData === true,
    who: job?.account ?? job?.profileKey ?? "this account",
  });
  if (!policy.clarify && !demoAgreement.ok) {
    // REJECT, NOT CLARIFY, unchanged: neither side of this mismatch is something a re-send can fix.
    policy = { clarify: null, reject: demoAgreement.reject };
  }

  // deliveryRoute "portal" is validated shape-wise but has NO consumer yet (the courier would email it
  // anyway) — an unavailable selection, same discipline as an unbuilt level: clarify, never a silent no-op.
  // Predicate and sentence both come from enqueue-schema.mjs (unchanged text): plan_run's free preview now
  // refuses it in the SAME words, and a wall that phrases the refusal differently from the preview that
  // promised the run is how a client is told two things about one request.
  if (!policy.clarify && wantsPortalRoute(job))
    policy = { clarify: PORTAL_ROUTE_UNAVAILABLE };
  // A REJECT AND A CLARIFY LEAVE BY THE SAME DOOR, in different words: `reject` is not re-sendable and
  // must not be notified as though it were (intakeNotify branches on exactly this).
  const rejectMsg = policy.reject ?? null;
  const gateMsg = rejectMsg ?? policy.clarify ?? gateResolvedPolicy(policy);
  if (gateMsg) {
    note(`[runner] ${base} search-policy ${rejectMsg ? "reject" : "clarify"}: ${gateMsg}`);
    await failAtIntake(procPath, qdir, base, agentId, job,
      { classify: rejectMsg ? "reject" : "clarify", errors: [gateMsg] }, [gateMsg]);
    return null;
  }
  // EVERY RULE THAT NEEDS THE RESOLVED PRODUCT — THE WALL. The name count, the scope-vs-machinery fit
  // and the (product × scope) combination rules, folded in ONE function (scope-rules.mjs
  // checkResolvedProduct) that the portal's plan gate, plan_run, start_run, the CLI and the dev cockpit
  // now call as well. Every door lands here (email, portal, MCP, CLI, cockpit), so this is the only
  // place the rules cannot be bypassed; the checks at the doors exist to say it EARLIER, never instead.
  //
  // What each of them catches: a profile-default or scope-derived product's name count (validateJob can
  // only budget an EXPLICIT one); scope the machinery cannot honour, which must clarify rather than be
  // frozen into a sidecar nothing reads; a requested native-language investigation on a product that
  // does not carry it, or whose scope routes no lane, which would bill a deepening over nothing; and a
  // Full country search over five countries, which is five shallow reads sold as one deep one.
  //
  // Fail-open ONLY where the measurement is genuinely unknowable: with no effective profile the
  // account's default territories are unreadable, so "this request resolves to no territory" would be a
  // claim about a scope we never saw. That is `profileReadable:false`, and the rules make it themselves
  // — when the request (or the saved search it names) DOES name territories, the profile is irrelevant
  // to the count and they still bite.
  if (!effProfile) note(`[runner] ${base} scope-rules: profile resolution errored — the account's default territories are not evaluable, so only what the request itself names is judged (fail-open by doctrine, logged for visibility)`);
  const resolvedGates = checkResolvedProduct({ job, profile: effProfile, resolved: policy, profileReadable: Boolean(effProfile) });
  if (resolvedGates.errors.length) {
    // WHICH check refused rides the note, from the fold's own split — an operator reading the log needs
    // to know whether this was the budget or the geography, and a joined list of sentences does not say.
    const which = Object.entries(resolvedGates.byCheck).filter(([, e]) => e.length).map(([n]) => n).join("+");
    note(`[runner] ${base} ${which} clarify: ${resolvedGates.errors.join("; ")}`);
    await failAtIntake(procPath, qdir, base, agentId, job, { classify: "clarify", errors: resolvedGates.errors }, resolvedGates.errors);
    return null;
  }
  // Non-blocking by design: a deepening whose lane the account switched off, or a routing territory that
  // reaches the stated scope but not decideJxLanes, is said out loud at the door where the money is
  // spent rather than left to be inferred from an empty sidecar.
  for (const w of resolvedGates.warnings) note(`[runner] ${base} ${w}`);
  // qw/cn-scope-honesty (b) — non-blocking recommendation (the budget.warnings posture, exactly): a run
  // whose requested scope names a zh-lane jurisdiction (CN/HK/TW/MO) but whose product does not carry the
  // native-language investigation is told where that investigation is offered. A NOTE only — never a
  // clarify/park, never a product substitution; the run proceeds as requested.
  for (const n of zhScopeDepthNotes(job, policy, effProfile)) note(`[runner] ${base} ${n}`);
  // Per-account admission caps (Phase 3b) — the resolved effective profile is in hand; over-cap
  // clarifies before any spend and before the matter is recorded.
  if (!effProfile) note(`[runner] ${base} run-caps skipped — profile resolution errored, caps not evaluable for this admission (fail-open by doctrine, logged for visibility)`);
  const capMsg = checkRunCaps({ account: effProfile?.key ?? null, caps: effProfile?.runCaps, queueDirs: config.queueDirs,
    inHandTagged: Boolean(job.profileKey), clientRun: job.clientPrincipal === true });
  if (capMsg) {
    note(`[runner] ${base} ${capMsg}`);
    await failAtIntake(procPath, qdir, base, agentId, job, { classify: "clarify", errors: [capMsg] }, [capMsg]);
    return null;
  }
  // Matter-dedup gate (the observed double-enqueue): a prior run of THIS matter from another message — e.g.
  // a "please proceed" reply that re-ran intake on the same thread — must not trigger a second search. This
  // check+record runs serially (drainQueue awaits each claimAndPrep), so a concurrent same-matter pair is
  // still caught: the first records the matter before the second is prepped. The signature carries the
  // RESOLVED level (a level change is never a duplicate — the escalation flow).
  const sig = matterSignature(job, { product: policy.product });
  const conversationId = String(job.conversationId ?? "").trim();
  const dupNow = Date.now();
  // dupOverride: an explicit, requester-confirmed "yes, genuinely re-run this mark". Skip the dedup GATE
  // but STILL record the matter, so a forced run seeds the ledger and any later true duplicate is caught.
  // (This is the working force-run path; the bare .duplicate -> .json rename re-matches within the window.)
  if (job.dupOverride) {
    note(`[runner] ${base} carries dupOverride — skipping matter-dedup gate (forced run; sig=${sig} conv=${conversationId || "-"})`);
  } else {
    const prior = findDuplicateMatter(qdir, { sig, conversationId, msgId: job.msgId }, dupNow);
    if (prior) {
      note(`[runner] duplicate ${base} (sig=${sig} conv=${conversationId || "-"}) matches msgId ${prior.msgId} — parking as .duplicate, not running`);
      await parkDuplicate(procPath, qdir, base, agentId, job, prior, sig);
      return null;
    }
  }
  recordMatter(qdir, { sig, conversationId, msgId: job.msgId, id: job.id, ts: dupNow,
    ...(effProfile?.key && effProfile.key !== "generic" ? { profileKey: effProfile.key } : {}),
    // positive-only, and it is what tomorrow's daily count reads. A run that omits it is a staff,
    // email or CLI run and never consumes a client's allowance.
    ...(job.clientPrincipal === true ? { clientPrincipal: true } : {}),
    ...(job.enqueuedBy ? { enqueuedBy: String(job.enqueuedBy).slice(0, 120) } : {}) });
  note(`[runner] claimed ${base} (agent=${agentId} msgId=${job.msgId})`);
  return { procPath, base, job };
}

// — WHAT THIS PARK IS WAITING ON, DERIVED FROM THE PARK RATHER THAN ASSERTED OVER IT.
//
// The pipeline returns `postponed: true` from two places and they are not the same event:
//
//   postponeRun          a PROVIDER refused the dispatch. `resetsAt` is the provider's own reset, read
//                        off the engine's `rate_limit_event`, and the wait depends on somebody else.
//   the recovery park    the RUN backed off from its own failure. Its clock is `recoveryResumesAt`, a
//                        backoff this code chose, and the wait depends on us.
//
// `recovery: true` rides the second one, so the discriminator needs no new plumbing — it was on the
// result the whole time and the marker threw it away.
//
// WHAT THIS DOES NOT DO: invent a cause. Neither branch classifies anything; each states which park
// fired and what its clock means. 's damage was a record that could not be contradicted from the
// artifacts, so the fix is not a better guess — it is saying less, and saying which.
export function parkCause(res = {}) {
  const RESOLVED_BY = "a live retry — the stored time is a hint about when to look, not the authority on "
    + "whether to. This run wakes at the earlier of that time and its next probe, retries, and either "
    + "continues or re-parks against a fresh one. Nothing needs editing by hand.";
  return res.recovery === true
    ? {
      parkKind: "recovery",
      // NAMES ITS OWN CLOCK. Calling this a reset would repeat the defect in the field beside it: the
      // marker's `resetsAt` carries this value, and a reader who is told it is a provider reset cannot
      // tell a backoff we chose from a refusal we were given.
      waitingOn: "this run's own recovery backoff after a recoverable failure (the wait is ours, not a "
        + "provider's; the stored time is this park's retry clock, NOT a provider reset)",
      resolvedBy: RESOLVED_BY,
    }
    : {
      parkKind: "rate-limit",
      waitingOn: "provider rate limit (the cap that refused the last dispatch)",
      resolvedBy: RESOLVED_BY,
    };
}


// EXPENSIVE half: run the pipeline (slot-lock-throttled) + finalize the queue entry. Safe to run
// CONCURRENTLY across a queue's prepared jobs — each owns its own .processing/.pid + run dir, and the
// matter-dedup was already settled serially in claimAndPrep. The run-slot cap (acquireRunSlot) bounds how
// many pipelines actually run at once.
async function runPrepared({ procPath, base, job }, qdir, agentId, resumeMeta = null) {
  const studioRoot = config.studioRootForAgent(agentId);
  const archiveRoot = config.archiveRootForAgent(agentId);
  // B1 — persist the run identity AT DISPATCH, before any spend. A fresh job pre-mints its codename here
  // (mintFreshCodename — the SAME collision-aware mint buildRunContext uses; a raw genCodename would lose
  // the freshness protection) and dispatches with {codename, date, minted:true}; a resume reuses the prior
  // codename verbatim. Either way the identity lands in `<base>.processing.meta` (tmp+rename, atomic) so a
  // hard crash re-claims into a RESUME of this exact run instead of minting a new codename and re-running
  // every completed billable stage (the historical double-report tail).
  const preminted = resumeMeta?.codename ? null
    : { codename: mintFreshCodename({ slug: deriveSlug(job), date: todayISO(), studioRoot, archiveRoot }), dateISO: todayISO() };
  const identity = preminted ?? { codename: resumeMeta.codename, dateISO: resumeMeta.dateISO ?? null };
  try {
    const metaPath = `${procPath}.meta`;
    // `reclaims` (A5) survives the dispatch re-persist: it is the crash-reclaim counter the bound in
    // reclaimOrphanedClaims reads — wiping it here would re-arm an unbounded resume loop.
    writeFileSync(`${metaPath}.tmp`, JSON.stringify({ codename: identity.codename, dateISO: identity.dateISO, agentId,
      ...(Number(resumeMeta?.reclaims) > 0 ? { reclaims: Number(resumeMeta.reclaims) } : {}) }, null, 2) + "\n");
    renameSync(`${metaPath}.tmp`, metaPath);
  } catch (e) { note(`[runner] ${base} identity sidecar write failed (non-fatal — a crash-reclaim falls back to a fresh mint): ${e?.message ?? e}`); }
  // A5 — register the dispatch in the in-flight registry so a grace-exit can park exactly the runs it
  // cuts. Identity only, and the run dir is resolved at park time — where it may not exist yet: pipeline()
  // creates it below, so a cut landing between this line and that one finds no dir and parks nothing
  // (`if (!owned …) continue` in parkInFlightForHuman). Nothing is lost in that window — with no run dir
  // there is no status.json left saying "running" either, and the identity meta written just above is the
  // whole recovery. Stated plainly because the previous wording said the dir "certainly exists", and an
  // arm built on that claim reddened main for one commit.
  inFlightRuns.set(procPath, { slug: deriveSlug(job), codename: identity.codename, dateISO: identity.dateISO ?? null, agentId, studioRoot, archiveRoot });
  let res;
  try {
    // Run as the forwarding agent, with the run-dir + archive rooted in THAT agent's workspace (so the
    // agent's sandboxed write tool can reach them). Delivery still publishes to the central pool. resumeMeta
    // (set by resumePostponed / the crash-reclaim) reuses the prior codename's valid stages via the pipeline
    // resume path; a fresh job dispatches its pre-minted identity as a cold start (minted:true).
    res = await pipeline(job, {
      agent: agentId, studioRoot, archiveRoot,
      // A2 — pass the dispatch-persisted dateISO so the RESUME targets the EXACT `${dateISO}-${codename}`
      // run dir. Without it the pipeline re-resolves the date via a date-agnostic findRunDate() that could
      // land on a lingering same-slug dir from an earlier date sharing this codename (a stale-dir resume).
      ...(resumeMeta ? { codename: resumeMeta.codename ?? undefined, fromStage: resumeMeta.fromStage ?? undefined, date: resumeMeta.dateISO ?? undefined } : {}),
      ...(preminted ? { codename: preminted.codename, date: preminted.dateISO, minted: true } : {}),
    });
  } catch (e) {
    res = { ok: false, reason: String(e?.stack ?? e) };
  } finally {
    inFlightRuns.delete(procPath);   // settled (any way) — a grace exit must not park a finished run
  }
  // RATE-LIMIT POSTPONE: park as `<base>.postponed` (+ .meta), NOT terminal — resumePostponed re-dispatches it
  // once resetsAt passes. Keep the matter-ledger entry (do NOT dropMatter) AND the prose sidecars (the resume
  // re-assembles the job from them); the run dir + every valid stage stay intact for the resume.
  if (res.postponed) {
    parkPostponed(procPath, qdir, base, {
      // — THE DUE CLOCK IS WRITTEN UNDER ITS OWN NAME, and this is not only a label fix.
      //
      // Both pipeline parks return their clock as `res.resetsAt` — the recovery park at
      // pipeline.mjs deliberately so, because that field is "the runner's due-clock contract". This
      // writer then copied it into the marker as `resetsAt` whatever the park was, so a recovery park
      // — our own backoff after our own defect — recorded a PROVIDER CAP RESET. That is the field beside
      // the one fixed, and `parkCause` predicted it in as many words: "the marker's `resetsAt`
      // carries this value, and a reader who is told it is a provider reset cannot tell a backoff we
      // chose from a refusal we were given."
      //
      // THE BEHAVIOURAL HALF, which the field-name framing understates. `postponedDueAt` reads BOTH keys
      // and does NOT treat them alike:
      //
      //     return key === "resetsAt" ? Math.min(t, probeAt) : t;
      //
      // with its own reason: "A RECOVERY park is our own backoff, not an external party's deadline, so
      // there is nothing to re-check and nothing that can go stale — it keeps its exact clock. Only an
      // externally-supplied reset is probed, because only it can be contradicted by the world." Because
      // every recovery clock arrived under `resetsAt`, it took the probe branch and was clamped by a
      // schedule built for provider caps. The reader was right and unreachable.
      //
      // NEVER BOTH: `postponedDueAt` states that "a sentinel never carries both", and the recovery arm
      // writes `resetsAt: null` to keep that true rather than leaving a stale key beside the live one.
      // The reader's loop tries `resetsAt` first and skips a null, so the correct clock is still found.
      //
      // The discriminator is the one already in use on the line below — `parkCause` branches on exactly
      // `res.recovery === true`, so there is no second classifier here to drift from it.
      ...(res.recovery === true
        ? { recoveryResumesAt: res.resetsAt ?? null, resetsAt: null }
        : { resetsAt: res.resetsAt ?? null }),
      codename: res.codename ?? identity.codename ?? null,
      dateISO: identity.dateISO ?? null,
      // The run dir, so claimDuePostponed can see a `.cancel` marker WITHOUT re-deriving the path from
      // slug+date+codename. A park written before this field existed simply has none: that run resumes
      // and the gateway's own check stops it on its first turn instead. One claim cycle, no model spend.
      runDir: res.runDir ?? null,
      // — THE MATTER THIS PARK BELONGS TO, so a cancel can free it.
      //
      // A cancel taken while a run is RUNNING frees its matter-ledger row: the terminal block below
      // calls dropMatter under `if (!res.ok)`. A cancel taken while it is PARKED did not, because
      // retireCancelledPark had no way to name the matter — this meta carried the codename and the run
      // dir and not the msgId the ledger is keyed by. So stopping the same matter two seconds apart
      // gave two different answers about whether it could be re-submitted, and the parked case is the
      // likelier one: a park is precisely the long wait during which somebody gives up.
      //
      // Same shape and same backward-compat story as `runDir` above: a park written before this field
      // existed simply has none, and its cancel leaves the row as it did before — no worse than today,
      // and it frees itself when the 24h dedup window closes.
      msgId: job?.msgId ?? null,
      fromStage: res.fromStage ?? resumeMeta?.fromStage ?? null, agentId, postponedAt: new Date().toISOString(),
      // — how many times this run has already woken, tried, and been refused. postponedDueAt grows
      // the probe interval off it, so a cap that really is long costs a handful of rejected dispatches
      // instead of one every interval. A park written before this field existed reads 0 and probes at
      // the base interval, which is the conservative direction.
      probeAttempt: (Number(resumeMeta?.probeAttempt) || 0) + 1,
      // — "Parked until T" is not a statement of what the wait depends on. A park says what it is
      // waiting on and how it will find out the wait is over, in the record itself, because the whole
      // failure this fixes was indistinguishable from working-as-designed to anyone reading it.
      //
      // — AND IT HAS TO SAY WHICH PARK THIS IS, because these two lines used to be CONSTANTS.
      // Not a classifier that guessed wrong: a literal, written onto every `res.postponed` — and
      // `res.postponed` is true for BOTH pipeline parks, the rate-limit one (postponeRun) and the
      // recovery one, which carries `recovery: true`. So a run that parked to back off from its own
      // defect had a queue marker asserting a PROVIDER QUOTA REFUSAL, and `resetsAt` presented that
      // park's recovery backoff clock as a cap reset.
      //
      // Measured on the R5 park of 2026-08-17: `recoveryLane: "defect"`, `recoveryAttempts: 1`,
      // and `recoveryResumesAt` equal to the marker's `resetsAt` to the millisecond — the same park,
      // recorded as a rate limit. There is no subscription cap on that account, so the record asserted a
      // refusal by a provider with nothing to refuse with, and nothing in the artifacts could contradict
      // it. It reached a pre-registration, an e2e finding, a briefing and an owner status report before
      // the owner's knowledge of the account caught it.
      //
      // The pipeline already made this distinction where it writes its own sentinel — "only the recovery
      // sentinel carried a discriminator … the 2026-07-28 postmortem misread: a recovery park diagnosed
      // as a rate-limit park". The queue-side marker never got it. Same shape as 's terminal fields
      // reaching two writers and not four, and 's stamp reaching the audit path and not the rebuild.
      ...parkCause(res),
    });
    note(`[runner] ${base} → POSTPONED (${parkCause(res).parkKind}; retries at the earlier of ${res.resetsAt ?? "its due time"} and its next probe — no hand-edit needed if it clears early)`);
    return res;
  }
  // A stop is its own terminal, not a failure: `.failed` here would make the per-agent queue record say
  // the run broke, and `.done` would say it delivered. Neither happened.
  retireMarker(procPath, join(qdir, `${base}.${res.ok ? "done" : res.cancelled ? "cancelled" : "failed"}`), "run terminal");
  cleanupClaimSidecars(procPath);
  // a parkPostponed cut before its marker rename leaves a same-base `.postponed.meta` stray; left behind
  // on this claim's terminal it would keep the codename queue-owned forever (queueOwnedCodenames) and
  // block the run-dir self-resume dedup for it — sweep it with the other sidecars.
  try { rmSync(join(qdir, `${base}.postponed.meta`), { force: true }); } catch { /* best-effort */ }
  cleanupProseParts(qdir, base);
  writeFileSync(join(qdir, `${base}.${res.ok ? "done" : res.cancelled ? "cancelled" : "failed"}.result`), JSON.stringify(res, null, 2) + "\n");
  if (!res.ok) {
    dropMatter(qdir, job.msgId); // a failed run must not block a genuine re-send of this matter
    // B3 — markers first (above), notice second: a pre-try{} throw never reached the pipeline's own
    // failure lane, so the runner writes the packet/ping here (no-op when the pipeline already noticed).
    await backstopFailureNotice({ res, job, agentId, base, codename: identity.codename, studioRoot, archiveRoot });
  }
  note(`[runner] ${resumeMeta ? "resumed " : ""}${base} → ${res.ok ? "done" : res.cancelled ? "stopped by user" : "failed"}`);
  return res;
}

// unref so a pending poll never keeps the process alive past the last settled run (the in-flight
// pipelines' own I/O holds the event loop while work remains).
const delay = (ms) => new Promise((r) => { const t = setTimeout(r, ms); if (t.unref) t.unref(); });

// ADMISSION BUDGET (C3 companion): Type=oneshot means the WHOLE drain runs inside one systemd
// "activating" window, and the continuous-admission loop keeps claiming until the queue is empty —
// so a multi-job backlog (each run ~1.5h+, one observed gather member alone 8763s ≈ 2h26m) makes the
// activation's wall time unbounded by honest work alone. With TimeoutStartSec now a finite ceiling,
// that would let systemd SIGKILL a legitimately-progressing drain mid-run (pre-B1: fresh-codename
// re-spend + the historical double-report tail). Fix: past this budget the runner claims NO new jobs,
// lets what's already in flight finish, and exits 0 — unclaimed *.json remain in the queue, so the
// .path unit's PathExistsGlob retriggers a FRESH activation immediately (fresh TimeoutStartSec clock;
// the 90s timer backstops .postponed/orphans the glob can't see). The systemd ceiling therefore only
// ever fires on a WEDGED runner. Invariant (pinned in test/deploy-lifecycle.test.mjs): the unit's
// TimeoutStartSec must exceed this budget + the longest legitimate single run's wall time.
const DEFAULT_ADMISSION_BUDGET_MS = 2 * 60 * 60 * 1000;
let admissionDeadline = Infinity;
function admissionOpen() { return Date.now() < admissionDeadline; }

// ── B6 — graceful stop (SIGTERM/SIGINT) ──────────────────────────────────────────────────────────────
// systemctl stop/restart (Type=oneshot; the default KillMode signals the whole control group, so the
// engine children get their own SIGTERM regardless) and a ^C on a manual drain used to hit a runner with
// NO handler: node's default die-now killed the process mid-claim-loop and every in-flight claim looked
// live until the pid died — pre-B1 that re-minted codenames on the next activation (full re-spend). The
// handler's whole job is to NOT start new work and exit promptly: (1) close admission (the same gate the
// budget uses — queue-marker renames already in progress are atomic and are never interrupted), (2) let
// in-flight pipeline() work finish or reach its postpone checkpoint, (3) exit anyway after a bounded
// grace window — the B1 identity meta turns whatever gets cut into a RESUME next activation. A second
// signal exits immediately. Installed by the MAINLINE only (in-process test imports drive drainQueue
// directly and must not stack listeners).
let stopSignal = null;
const stopRequested = () => stopSignal !== null;
// The one admission predicate: budget elapsed OR stop requested ⇒ claim nothing new.
function admitting() { return !stopRequested() && admissionOpen(); }
function admissionClosedWhy() { return stopRequested() ? `${stopSignal} received` : "admission budget elapsed"; }

// ── A5 — in-flight registry + grace-exit "parked-for-human" ─────────────────────────────────────────
// The grace-exit used to write NOTHING into the run it cut: the queue kept a live-looking `.processing`
// (fine — the B1 identity meta resumes it next activation) but status.json still said "running" with
// the step it had reached, so every surface showed a run in flight with no process behind it — the
// 2026-07-28 postmortem zombie face. runPrepared registers each dispatch's identity here; when the grace window
// (or a second signal) cuts the process, every registered run gets a `.parked` sentinel + status
// "parked-for-human" so the surfaces tell the truth about WHY nothing is moving. Deliberately
// NON-BLOCKING: a systemd deploy restart is the NORMAL SIGTERM case, so nothing may gate the resume on
// a human — the pipeline resume guard clears `.parked`, the reclaim lane resumes the run, and the seed
// flips the state back to running. If no activation ever comes, the parked state is the honest handoff.
const inFlightRuns = new Map();   // claim path -> { slug, codename, dateISO, agentId, studioRoot, archiveRoot }
export function parkInFlightForHuman(signal, { registry = inFlightRuns } = {}) {
  for (const f of registry.values()) {
    try {
      const owned = findRunDirFor({ codename: f.codename, slug: f.slug, dateISO: f.dateISO ?? null, studioRoot: f.studioRoot, archiveRoot: f.archiveRoot });
      if (!owned || owned.kind === "archived" || runDirDelivered(owned.dir)) continue;   // finished (or never started) — nothing to park
      writeFileSync(join(owned.dir, ".parked"), JSON.stringify({ kind: "grace-exit", signal, codename: f.codename, agent: f.agentId, ts: new Date().toISOString() }, null, 2) + "\n");
      writeRunStatus(null, { state: "parked-for-human", parkedKind: "grace-exit",
        reason: `the runner was stopped (${signal}) with this run in flight — it resumes on the next runner activation` }, owned.dir);
      try { runLog(owned.dir, { event: "parked-for-human", kind: "grace-exit", signal }); } catch { /* spine append best-effort */ }
      note(`[runner] ${f.codename}: parked-for-human (grace exit on ${signal}) — resumes via its identity meta next activation`);
    } catch (e) { note(`[runner] grace-exit park failed for ${f.codename} (non-fatal — the identity meta still resumes it): ${e?.message ?? e}`); }
  }
}
export function installStopHandlers({ exit = (c) => process.exit(c) } = {}) {
  const onStop = (sig) => {
    if (stopRequested()) {
      note(`[runner] second ${sig} — exiting immediately`);
      parkInFlightForHuman(sig);   // sync, best-effort — the cut runs still get an honest state
      exit(1); return;
    }
    stopSignal = sig;
    const graceMs = Math.max(0, Number(process.env.CLEAROTRON_STOP_GRACE_MS ?? 60000));
    note(`[runner] ${sig} — graceful stop: claiming nothing new; in-flight work gets ${Math.round(graceMs / 1000)}s to finish or postpone`);
    // unref'd: when the drain settles first, the process exits 0 naturally and this timer never fires.
    const t = setTimeout(() => {
      note(`[runner] grace window elapsed — exiting (any cut in-flight claim resumes via its identity meta next activation)`);
      parkInFlightForHuman(sig);   // A5 — the cut runs say so on every surface instead of reading "running"
      exit(1);
    }, graceMs);
    if (t.unref) t.unref();
  };
  process.on("SIGTERM", () => onStop("SIGTERM"));
  process.on("SIGINT", () => onStop("SIGINT"));
}

// When a rate-limit-postponed job becomes due to RESUME, in epoch-ms. A 5h-cap rejection carries resetsAt and
// is honored exactly; when the 429 carried NO reset timestamp (resetsAt null/invalid), fall back to a fixed
// backoff from postponedAt rather than resuming on the next tick — an immediate resume would re-hit the same
// cap and hot-loop, each iteration re-running a stage and burning tokens. No usable meta at all → 0 (due now,
// fail-open: never strand a parked run on a meta read/parse hiccup). PURE + exported for the unit test.
// ── — A STORED DEADLINE IS A HINT ABOUT WHEN TO LOOK, NEVER THE AUTHORITY ON WHETHER TO ─────────
//
// This function used to return the stored `resetsAt` and stop there, so a run slept to a timestamp the
// world had already invalidated. On 2026-08-06 a subscription cap was lifted ahead of its stated reset
// and the parked run did not resume: it came back only after a human nulled the stale `resetsAt` BY HAND
// in the queue meta AND in the run-dir sentinel — either can resume independently, so one edit would not
// have been enough.
//
// The park was correct. The blocker was a RECORD that had gone stale, and that failure mode is the
// expensive one because it looks exactly like waiting. Nobody investigates a run behaving as designed,
// so the cost is however long it takes someone to think of it — here, a reset that was 40 hours out.
//
// THE FIX IS NOT A SHORTER POLL, and the issue says so directly. A shorter poll still treats the stored
// deadline as the truth and merely re-reads it sooner. What changes here is WHO DECIDES: the provider
// does, on a live request, and the only way to ask is to try. So a park now wakes at
//
//     min(the stated reset, postponedAt + a probe interval)
//
// and the probe interval grows with each unsuccessful probe. If the cap really is still in force the
// resumed run meets a 429 on its first dispatch and re-parks with a FRESH provider-supplied reset — cheap,
// because a resume skips every completed stage and the probe is that one rejected dispatch. If the cap
// lifted early the run continues at the next probe, with nobody editing anything.
//
// The hot-loop this function was originally written against (an immediate resume re-hitting the cap,
// re-running a stage each time) is what the growing interval and the ceiling exist for. The stated reset
// is still honoured as an UPPER bound — we never wait longer than the provider said, and we may wait
// less, which is the whole point.
//
// ONE CALCULATION, FOUR CALLERS. The queue claim, the run-dir self-resume, the idle gate and the
// recovery park all read this function, so the two records that can independently resume a run cannot
// disagree about whether it may — the property asks for, obtained by construction rather than by
// keeping two copies in step.
//
// PURE + exported for the unit test.
export function postponedDueAt(meta, backoffMs, { probeMs = config.rateLimitProbeMs, probeCeilingMs = config.rateLimitProbeCeilingMs } = {}) {
  const parkedAt = meta?.postponedAt ? Date.parse(meta.postponedAt) : NaN;
  // The next moment worth ASKING, independent of what the record claims. Doubling per failed probe so a
  // genuinely long cap costs a handful of rejected dispatches rather than one every interval, ceilinged
  // so it can never grow back into "sleep until the record says so".
  const attempt = Math.max(0, Math.min(16, Number(meta?.probeAttempt) || 0));
  const probeAt = Number.isNaN(parkedAt) ? Infinity
    : parkedAt + Math.min(probeCeilingMs, probeMs * 2 ** attempt);

  // The due clock carries a kind-specific name since the A4 field split: `resetsAt` (rate-limit cap
  // reset) or `recoveryResumesAt` (recovery-park backoff). Either is the STATED resume time; a sentinel
  // never carries both.
  for (const key of ["resetsAt", "recoveryResumesAt"]) {
    if (meta?.[key]) {
      const t = Date.parse(meta[key]);
      // A RECOVERY park is our own backoff, not an external party's deadline, so there is nothing to
      // re-check and nothing that can go stale — it keeps its exact clock. Only an externally-supplied
      // reset is probed, because only it can be contradicted by the world.
      if (!Number.isNaN(t)) return key === "resetsAt" ? Math.min(t, probeAt) : t;
    }
  }
  if (!Number.isNaN(parkedAt)) return parkedAt + backoffMs;
  return 0;
}

// Auto-resume: CLAIM (not run) any POSTPONED run whose rate-limit window (resetsAt) has elapsed — rename
// `<base>.postponed` → `.processing`, re-assemble the job from its surviving sidecars, and return
// {prepared, meta} for drainQueue's admission loop to launch (non-blocking, so a resumed run shares the
// same run-slot pool as fresh jobs). A postponed job keeps its manifest + prose sidecars, so it resumes
// (--resume <codename> --from <fromStage>) reusing every valid stage.
/**
 * — A RUN CANCELLED OUT OF A PARK, RETIRED ON BOTH SIDES.
 *
 * The queue side was already right: the marker becomes `.cancelled` and the run never resumes. The RUN
 * DIR was not touched at all, so a run dir measured on 2026-08-19 said:
 *
 *     status.json          {"state": "postponed"}      ⛔ a terminal run reporting a LIVE state
 *     .postponed           resetsAt 2026-08-19T16:50Z  ⛔ a future resume clock on a job that is over
 *     .cancelled.result    absent                      ⛔ the running-path cancel writes one
 *
 * A reader of the run dir alone sees a run waiting for a rate-limit window that will never come, and
 * `postponed` is exactly the state an operator is told to wait out rather than investigate. Any census
 * filtering on it counts this run as live for ever.
 *
 * WHY THE OLD COMMENT HERE WAS TRUE AND STILL LEFT THE HOLE. It said stop_run "has already written the
 * terminal status for a parked run, so all that is owed here is the queue side" — and stop_run does
 * exactly that, for a run that is ALREADY parked when Stop is pressed. The measured run was not. It was
 * stopped at 16:00:33 while RUNNING (so stop_run took its running branch: `.cancel` and nothing else),
 * and it parked at 16:07:30, seven minutes later, when a provider rate limit refused a dispatch. The
 * park writer then wrote a full set of live park surfaces over a run that was already cancelled.
 *
 * So the two orderings are not symmetric, and the comment described only one of them. This path cannot
 * assume anything about what stop_run did, because it cannot know which order the two events arrived in.
 * It writes the terminal surfaces itself, and they are idempotent when stop_run got there first.
 *
 * ORDER IS DELIBERATE: the terminal lands BEFORE the park sentinel is cleared. The reverse leaves a
 * window where the run dir has neither a live park nor a terminal — a run that reads as nothing at all.
 *
 * Returns what it managed to write, so the caller can say so and a test can assert it rather than
 * inferring it from a filesystem it also has to build.
 */
export function retireCancelledPark(qdir, base, meta = {}) {
  const runDir = meta?.runDir ?? null;
  const did = { result: false, status: false, sentinel: false, parkCleared: false, matterFreed: false };
  // Queue side, matching the shape runner's own terminal writes for a cancel — `ok:false, cancelled:true`
  // is what every reader of a `.result` already understands, and `scripts/e2e.mjs` reads these directly.
  try {
    writeFileSync(join(qdir, `${base}.cancelled.result`), JSON.stringify({
      ok: false, cancelled: true, failedStage: "parked",
      codename: meta?.codename ?? null, runDir,
      via: "runner/claimDuePostponed",
      note: "stopped while parked — the park was never resumed, so no stage ran after the cancel",
    }, null, 2) + "\n");
    did.result = true;
  } catch { /* best-effort — the .cancelled marker is the terminal, this is the detail beside it */ }

  if (!runDir) return did;   // a park with no recorded run dir: the queue side is all there is to do

  // THROUGH THE GUARDED WRITER, which is what the rest of this file uses and which refuses to reopen an
  // already-terminal run — so a stop_run that got here first is not overwritten, it is agreed with.
  try {
    // — this path knows only that the run was parked when it was stopped, and says exactly that
    // rather than inventing a door or an actor it cannot see.
    writeRunStatus(null, { state: "cancelled", failedStage: "parked", reason: stopReason({ stage: "parked" }),
      resetsAt: null, recoveryResumesAt: null },
      runDir, { critical: true });
    did.status = true;
  } catch { /* fail-open: a run that cannot record its state must still be retired */ }
  try {
    writeFileSync(join(runDir, ".cancelled"),
      JSON.stringify({ stage: "parked", via: "runner/claimDuePostponed", ts: new Date().toISOString() }) + "\n");
    did.sentinel = true;
  } catch { /* best-effort */ }
  // LAST, and only now: the live park record goes, because the terminal that replaces it is on disk.
  try { rmSync(join(runDir, ".postponed"), { force: true }); did.parkCleared = true; } catch { /* best-effort */ }
  // — AND THE MATTER IS FREED, as every other terminal writer frees it.
  //
  // This was the one terminal that did not. `dropMatter` MARKS the row failed rather than removing it
  // (the monthlyRuns cap counts spend, and a stopped run spent), and findDuplicateMatter skips failed
  // rows — so without this the matter stayed dedup-blocked for the rest of the 24h window with no run
  // to show for it, and the operator's re-submission parked silently as a duplicate.
  //
  // AFTER the terminals, deliberately, and for the reason the ordering note above gives: the record a
  // reader consults must never be freed before the record that says why.
  if (meta?.msgId) { dropMatter(qdir, meta.msgId); did.matterFreed = true; }
  return did;
}

export function claimDuePostponed(qdir) {
  const now = Date.now();
  const out = [];
  for (const f of readdirSync(qdir).filter((f) => f.endsWith(".postponed"))) {
    const base = f.replace(/\.postponed$/, "");
    let meta = {};
    try { meta = JSON.parse(readFileSync(join(qdir, `${base}.postponed.meta`), "utf8")); } catch { /* missing meta -> resume now (fail-open) */ }
    if (postponedDueAt(meta, config.rateLimitDefaultBackoffMs) > now) continue;   // window not elapsed yet
    // STOPPED WHILE PARKED. This is the resume path that most needs the check: a rate-limit park can
    // sit for hours, which is exactly when someone gives up and presses Stop — and a park has no turn
    // in flight, so the gateway's own check cannot fire. Without this the run would wake on its own
    // clock and carry on billing, and the cancel would silently undo itself.
    //
    // Retire the marker rather than skipping it: a `.postponed` that is skipped forever is a run that
    // reads "Paused" on the portal for the rest of time.
    //
    // — AND THE RUN DIR TOO. This used to retire the queue marker alone, on the reasoning that
    // `stop_run` had already written the terminal for a parked run. It does — for a run that was ALREADY
    // parked when Stop was pressed. A run stopped while RUNNING that parks afterwards reaches here with
    // live park surfaces and no terminal anywhere, and this path is the only thing that ever looks at it
    // again. See retireCancelledPark for the measured sequence.
    if (isCancelled(meta?.runDir)) {
      let won = false;
      // THE RENAME IS THE CLAIM. Nothing else is written until it succeeds, or two runners racing this
      // park both write a terminal for it and the loser's write lands after the winner's.
      try { renameSync(join(qdir, f), join(qdir, `${base}.cancelled`)); won = true; }
      catch { /* another runner got there first — it owns the retire, including the run dir */ }
      if (won) {
        try { rmSync(join(qdir, `${base}.postponed.meta`), { force: true }); } catch { /* best-effort */ }
        const did = retireCancelledPark(qdir, base, meta);
        note(`[runner] ${base} was STOPPED while parked — retiring the queue marker AND the run dir, not resuming `
          + `(result=${did.result} status=${did.status} sentinel=${did.sentinel} parkCleared=${did.parkCleared})`);
      }
      continue;
    }
    const procPath = join(qdir, `${base}.processing`);
    // — same atomic claim as claimAndPrep, and for the same reason: a resumed park is a live job the
    // moment its marker says `.processing`, so it must be covered by its liveness token before the marker
    // is visible. This path had the identical gap.
    const token = claimToken();
    const lockPath = `${procPath}.claimed-${token}`;
    try { renameSync(join(qdir, f), lockPath); } catch { continue; }   // lost the claim race to another runner
    try {
      writeFileSync(`${procPath}.pid.tmp`, token);
      renameSync(`${procPath}.pid.tmp`, `${procPath}.pid`);
    } catch (e) {
      note(`[runner] ${base} resume claim ABANDONED — could not write the liveness token (${e?.message ?? e}); leaving it parked`);
      try { rmSync(`${procPath}.pid.tmp`, { force: true }); } catch { /* best-effort */ }
      try { renameSync(lockPath, join(qdir, f)); } catch { /* the sweep restores it as .processing */ }
      continue;
    }
    renameSync(lockPath, procPath);   // publish, already covered
    // (3) — THE WAKE IS RECORDED, not only the park. run.jsonl carried `postponed` and nothing
    // for the other side of it, so a park that woke and then died mid-clearance read exactly like a park
    // that never woke at all: one `postponed` line and silence after it. The park sentinel does carry
    // `probeAttempt`, but it is OVERWRITTEN on every park — it says how many times, never when, and a
    // run that never re-parks leaves its last wake unrecorded entirely.
    //
    // Append-only and best-effort, like every other spine write here: a resume that cannot log is still
    // a resume, and throwing would turn an observability gap into a lost run.
    try {
      runLog(meta.runDir, { event: "park-resumed", via: "queue-marker",
        probeAttempt: Number(meta?.probeAttempt) || 0, parkedAt: meta?.postponedAt ?? null,
        kind: meta?.kind ?? null, fromStage: meta?.fromStage ?? null });
    } catch { /* spine append is best-effort */ }
    // Identity handoff, crash-ordered (B1): persist the codename to `.processing.meta` BEFORE dropping
    // `.postponed.meta`. The old "rm now, runPrepared re-persists at dispatch" pair had a window where
    // NO durable copy of the codename existed — a SIGKILL there left `.processing` with a dead pid and
    // no meta, so the next activation's legacy fresh re-claim minted a NEW codename over a perfectly
    // resumable run (and a surviving run-dir sentinel could self-resume the OLD one in parallel).
    if (meta?.codename) {
      try {
        writeFileSync(`${procPath}.meta.tmp`, JSON.stringify({ codename: meta.codename, dateISO: meta.dateISO ?? null, agentId: meta.agentId ?? null }, null, 2) + "\n");
        renameSync(`${procPath}.meta.tmp`, `${procPath}.meta`);
      } catch (e) { note(`[runner] ${base} identity handoff write failed (non-fatal — dispatch re-persists): ${e?.message ?? e}`); }
    }
    try { rmSync(join(qdir, `${base}.postponed.meta`), { force: true }); } catch { /* best-effort */ }
    const job = assembleJob(procPath, qdir, base);
    note(`[runner] resuming POSTPONED ${base} (codename=${meta.codename ?? "?"} from=${meta.fromStage ?? "auto"}; window elapsed)`);
    out.push({ prepared: { procPath, base, job }, meta });
  }
  return out;
}

// ── Self-resume for run-dir POSTPONED orphans ────────────────────────────────────────────────────────
// A run resumed MANUALLY (node pipeline.mjs --resume <codename>) writes a run-dir `.postponed` sentinel with
// NO queue sidecars, so the queue's claimDuePostponed never sees it — pre-fix it sat indefinitely until a
// human re-triggered it. We scan every agent's studio for run-dirs whose `.postponed` is DUE, skip those a
// queue job already owns (dedup by codename), atomically claim each (`.postponed` → `.resuming`, the rename
// IS the lock), and re-invoke pipeline() from the sentinel's self-contained {job, agent, codename, fromStage}
// payload. Idempotent: a resumed run skips every done stage; a re-postpone writes a fresh `.postponed`.
export function agentStudioRoots() {
  const out = [];
  try {
    for (const name of readdirSync(config.workspaceRoot)) {
      if (config.agentIdFromWorkspaceName(name) == null) continue;
      const s = join(config.workspaceRoot, name, "studio", "prelim-search");
      if (existsSync(s)) out.push(s);
    }
  } catch { /* workspaceRoot absent in some envs */ }
  return out;
}

function queueOwnedCodenames() {
  const owned = new Set();
  for (const q of config.queueDirs) {
    try {
      for (const f of readdirSync(q)) {
        if (!f.endsWith(".postponed.meta") && !f.endsWith(".processing.meta")) continue;
        try { const m = JSON.parse(readFileSync(join(q, f), "utf8")); if (m?.codename) owned.add(m.codename); } catch { /* skip */ }
      }
    } catch { /* queue dir absent */ }
  }
  return owned;
}

/**
 * — THE CODENAMES THE QUEUE HAS ALREADY SETTLED.
 *
 * DELIBERATELY NOT FOLDED INTO queueOwnedCodenames ABOVE, though folding them would produce the same
 * skip. "Owned" means ANOTHER LANE WILL DRIVE THIS RESUME; settled means NOBODY WILL. Expressing a
 * cancelled run as an owned one is a lie that happens to behave, and the next reader of that function
 * unpicks it — so the two questions keep two names.
 *
 * THE INVERSION THIS CLOSES, measured on the R6 round this issue was filed from: an operator retiring a parked job renames
 * the queue marker `.postponed` -> `.cancelled`, which takes its `.postponed.meta` out of the owned
 * set — so cancelling in the queue was the very act that HANDED the run to the run-dir watcher, with
 * nothing left claiming it. The strongest expression of "stop" available to an operator made the
 * resurrection more likely, not less.
 *
 * Reads the sidecar for the codename exactly as queueOwnedCodenames does, so both answers come from
 * one file format and a job whose meta is unreadable is absent from BOTH sets rather than from one.
 */
function queueTerminalCodenames() {
  const settled = new Set();
  const suffixes = TERMINAL_QUEUE_SUFFIXES.map((x) => `.${x}.meta`);
  for (const q of config.queueDirs) {
    try {
      for (const f of readdirSync(q)) {
        if (!suffixes.some((sfx) => f.endsWith(sfx))) continue;
        try { const m = JSON.parse(readFileSync(join(q, f), "utf8")); if (m?.codename) settled.add(m.codename); } catch { /* skip */ }
      }
    } catch { /* queue dir absent */ }
  }
  return settled;
}

/**
 * — is this `.resuming` claim held by a process that is gone?
 *
 * Two sources, in the order that cannot double-run a live search:
 *
 *   1. THE `.pid` SIDECAR, written beside the claim by resumeRunDirOrphans below, in exactly the
 *      queue's format. `claimerIsAlive`'s polarity is the load-bearing part and is reused rather than
 *      restated: a claimer is DEAD only on positive evidence — the pid is gone, or the pid is alive and
 *      provably a different process. An alive pid whose starttime cannot be read counts as ALIVE. Getting
 *      this backwards re-runs a billable search and delivers to the lawyer twice.
 *
 *   2. NO SIDECAR AT ALL ⇒ the claim predates this change, so the process that wrote it cannot be
 *      identified. Those are precisely the runs stuck invisible today, and refusing to touch them would
 *      ship a fix that recovers nothing already broken. They are recovered on AGE instead, against the
 *      same `maxClaimAgeMs` ceiling drainQueue uses as its escape hatch for a wedge this polarity keeps
 *      alive — 48h by default. A fresh sidecar-less `.resuming` is left alone, because on a box mid-
 *      upgrade it may be a live claim from the old code.
 *
 * `maxClaimAgeMs: 0` disables the age arm entirely, matching takeoverClaim's reading of the same knob.
 */
export function resumeClaimIsAbandoned(resumingPath, now = Date.now(), {
  isAlive = claimerIsAlive, maxClaimAgeMs = config.maxClaimAgeMs,
} = {}) {
  let sidecar = null;
  try { sidecar = parseClaimSidecar(readFileSync(`${resumingPath}.pid`, "utf8")); } catch { /* none */ }
  if (sidecar) return !isAlive(sidecar);
  if (maxClaimAgeMs <= 0) return false;
  try { return now - statSync(resumingPath).mtimeMs > maxClaimAgeMs; } catch { return false; }
}

// DUE run-dir `.postponed` orphans, NOT yet claimed (the caller claims via resumeRunDirOrphans). Pure read.
// — a terminal is announced ONCE per codename per process. The markers that
// express a cancel are permanent by design (cancel.mjs: "Nothing deletes .cancel"), so a note without
// this would restate the same refusal every watch tick for the life of the box, and the operator who
// needs to see it once would be the person least able to find it.
const announcedTerminalSkips = new Set();

export function scanDueRunDirOrphans(now = Date.now()) {
  const owned = queueOwnedCodenames();
  const settled = queueTerminalCodenames();
  const out = [];
  for (const studio of agentStudioRoots()) {
    let slugs = [];
    try { slugs = readdirSync(studio); } catch { continue; }
    for (const slug of slugs) {
      if (slug === "queue" || slug === "archive") continue;
      let runs = [];
      try { runs = readdirSync(join(studio, slug)); } catch { continue; }
      for (const runName of runs) {
        const runDir = join(studio, slug, runName);
        // ── — A `.resuming` WHOSE CLAIMER IS DEAD IS DUE AGAIN ──────────────────────────────────
        //
        // resumeRunDirOrphans renames `.postponed` → `.resuming` before driving the pipeline. Kill the
        // watcher inside that window — Ctrl-C, a reboot, an OOM — and the run dir holds `.resuming` and
        // no `.postponed`. `.resuming` was in the skip list below, so NO future watch start ever saw
        // that run again: not failed, not parked, not queued, invisible. A laptop watcher is exactly the
        // thing a user Ctrl-Cs without thinking, and exists because a parked run stopped silently —
        // this was the same shape one layer in, reachable by the very loop added to close it.
        //
        // The sentinel payload survives the rename (`.resuming` IS the old `.postponed` file), so
        // nothing needs reconstructing — only the decision that it is claimable again.
        //
        // Option (ii) on the issue was making the rename crash-safe so `.resuming` is never the only
        // marker on disk. This is option (i): reuse the liveness protocol the queue already runs, which
        // is proven by runner.claim-liveness.test.mjs and changes no sentinel contract.
        const resumingPath = join(runDir, ".resuming");
        const postponedPath = join(runDir, ".postponed");
        const abandoned = !existsSync(postponedPath) && existsSync(resumingPath)
          && resumeClaimIsAbandoned(resumingPath, now);
        const sentPath = abandoned ? resumingPath : postponedPath;
        if (!existsSync(sentPath)) continue;
        // a terminal/in-flight marker means this run already moved on after the sentinel was written — ignore
        // `.cancelled` is a terminal like `.delivered`/`.failed`; `.cancel` is the REQUEST, and it has to
        // be here too — a run stopped while parked may carry the request before any pass has written the
        // terminal, and this watcher would otherwise self-resume it straight past the user's decision.
        //
        // `.resuming` stays in this list for the ORDINARY path: a live self-resume must not be re-fired.
        // It is excluded only when this run IS the abandoned claim recovered above, which is the whole
        // of the change — the fail-safe polarity is unchanged and an unprovable claim still counts alive.
        const inFlight = [".delivered", ".failed", ".published", ".resuming", ".cancelled", ".cancel"]
          .filter((m) => !(abandoned && m === ".resuming"));
        if (inFlight.some((m) => existsSync(join(runDir, m)))) continue;
        let sent;
        try { sent = JSON.parse(readFileSync(sentPath, "utf8")); } catch { continue; }
        if (!sent.job || !sent.agent || !sent.codename) continue;          // pre-fix sentinel without payload — leave for manual handling
        if (owned.has(sent.codename)) continue;                            // the queue owns this resume — don't double-fire
        // ── — THE OTHER TWO WAYS A STOP IS SPELLED ──────────────────────────
        //
        // The run-dir markers checked above are ONE of three surfaces a cancel can land on, and the
        // only one this watcher used to read. An operator on the box cannot write them: `.cancel` has
        // a single caller (the MCP's stop_run), so a person at a shell expresses a stop by setting a
        // terminal `status.json` and retiring the queue marker — and this loop honoured neither.
        //
        // Measured on the R6 round this issue was filed from, 2026-09-03: cancelled on both of those surfaces, resumed from
        // here anyway on the next two worker starts, and the resume then CLEARED the run-dir evidence
        // so the second pass had nothing left to refuse on. Both checks are reads, so the function
        // keeps the "pure read" contract its callers and its arms depend on.
        // CANCELLED, not "any terminal". The first cut read the whole TERMINAL_STATES set and was
        // wrong for the same reason the pipeline's door was: `failed` is a terminal the RUNNER writes
        // about itself, and a failed run coming back is the recovery this watcher exists to perform.
        // `cancelled` is the only one a person sets, which is the issue's own criterion. (The run-dir
        // `.failed` marker still skips, as it always did, via the inFlight list above — that is a
        // different fact from the RECORD saying failed, and it is not being changed here.)
        const terminal = settled.has(sent.codename) ? `the queue marker is terminal`
          : (terminalRunState(runDir) === "cancelled" ? "status.json says cancelled" : null);
        if (terminal) {
          if (!announcedTerminalSkips.has(sent.codename)) {
            announcedTerminalSkips.add(sent.codename);
            note(`[runner] NOT resuming run-dir POSTPONED ${sent.codename} — ${terminal}; this run was stopped and stays stopped`);
          }
          continue;
        }
        if (postponedDueAt(sent, config.rateLimitDefaultBackoffMs) > now) continue;   // backoff window not elapsed
        out.push({ runDir, sentPath, job: sent.job, agent: sent.agent, codename: sent.codename, fromStage: sent.fromStage ?? null, reparks: Number(sent.reparks) || 0, payload: sent });
      }
    }
  }
  return out;
}

export async function resumeRunDirOrphans(orphans, { runPipeline = pipeline } = {}) {
  for (const o of orphans) {
    const claimPath = join(o.runDir, ".resuming");
    // ── THE RENAME IS THE CLAIM, AND THE RECOVERY PATH NEEDS ITS OWN ─────────────────────────────────
    //
    // Atomicity here is rename(2): two watchers racing the same sentinel both call it, one wins, the
    // loser gets ENOENT and drops out. On the recovery path the sentinel IS `.resuming`, so
    // renaming it to itself would be a no-op that SUCCEEDS FOR BOTH — no claim, two pipelines, one
    // billable search run twice and one lawyer delivered to twice. That is precisely the harm
    // claimerIsAlive's fail-safe polarity exists to prevent, arriving through the door built to help.
    //
    // So recovery re-arms the sentinel first: `.resuming` → `.postponed` is itself atomic and decides
    // the winner, and the ordinary claim below then runs unchanged. Two renames, same tick, and the
    // sentinel contract is untouched — which is what keeps this option (i) rather than option (ii).
    if (o.sentPath === claimPath) {
      // RECOVERY: the sentinel is ALREADY `.resuming`, so there is no rename left to decide a winner —
      // renaming it to itself succeeds for every caller, and a first draft of this did exactly that:
      // two watchers, two pipelines, one billable search run twice and one lawyer delivered to twice.
      // Re-arming it to `.postponed` and back does not fix it either, because the end state equals the
      // start state and the next caller wins just as easily.
      //
      // So the SIDECAR is the lock. Taking the dead claimer's `.pid` is a rename, which exactly one
      // watcher can complete; where there is no sidecar (a claim older than this change, recovered on
      // age) an exclusive create does the same job. Either way the loser gets an error and drops out,
      // and the sentinel contract is untouched — which is what keeps this option (i).
      // TWO GUARDS, because neither alone is enough and the first draft had neither.
      //
      // Re-read abandonment HERE rather than trusting the scan's verdict: between the scan and this
      // line another watcher may have claimed it, and its sidecar now names a LIVE process. Taking the
      // sidecar unconditionally is what made the second watcher win — the file is always present again
      // by the time it looks.
      const pid = `${claimPath}.pid`;
      if (!resumeClaimIsAbandoned(claimPath)) continue;    // somebody live holds it now
      try { renameSync(pid, `${pid}.superseded`); } catch { /* none — this one was recovered on age */ }
      // …and an EXCLUSIVE create decides the genuinely simultaneous case, where two watchers both read
      // the claim as abandoned before either wrote. Exactly one `wx` succeeds; the loser drops out
      // rather than driving a second pipeline over the same run.
      try { writeFileSync(pid, `${claimToken()}\n`, { flag: "wx" }); } catch { continue; }
      try { rmSync(`${pid}.superseded`, { force: true }); } catch { /* best-effort */ }
    } else {
      try { renameSync(o.sentPath, claimPath); } catch { continue; }   // atomic claim; loser finds it gone
    }
    // — WHO holds this claim, in the queue's own sidecar format. Without it the marker records
    // that a resume started and nothing about which process started it, so a watcher killed inside this
    // window left a run no future scan could tell apart from a live one. Best-effort: a claim with no
    // sidecar is still recoverable on age, and failing the resume over an unwritable sidecar would cost
    // the run for the sake of the mechanism meant to save it.
    try { writeFileSync(`${claimPath}.pid`, `${claimToken()}\n`); } catch { /* age arm covers it */ }
    // (3) — the same record on the OTHER resume path. Two doors reopen a park and a reader of
    // run.jsonl should not have to know which one was used to see that it reopened; `via` says which.
    // Read back off the claimed sentinel rather than carried through findRunDirOrphans: the fields are
    // already on disk, and threading them would put the same fact in two places to disagree.
    try {
      let sent = {};
      try { sent = JSON.parse(readFileSync(claimPath, "utf8")); } catch { /* pre-fix sentinel — log what we have */ }
      runLog(o.runDir, { event: "park-resumed", via: "run-dir-sentinel",
        probeAttempt: Number(sent?.probeAttempt) || 0, parkedAt: sent?.postponedAt ?? null,
        kind: sent?.kind ?? null, fromStage: o.fromStage ?? sent?.fromStage ?? null });
    } catch { /* spine append is best-effort */ }
    note(`[runner] self-resuming run-dir POSTPONED ${o.codename} (agent=${o.agent} from=${o.fromStage ?? "auto"}; window elapsed)`);
    try {
      await runPipeline(o.job, {
        agent: o.agent, codename: o.codename, fromStage: o.fromStage ?? undefined,
        studioRoot: config.studioRootForAgent(o.agent), archiveRoot: config.archiveRootForAgent(o.agent),
      });
      try { rmSync(claimPath, { force: true }); rmSync(`${claimPath}.pid`, { force: true }); } catch { /* pipeline wrote its own terminal/.postponed sentinel */ }
    } catch (err) {
      // Repair-first phase 2 (2026-07-05): a resume that THROWS (vs one that runs and re-parks itself)
      // used to re-park unbounded — a persistent infra error looped at tick cadence forever, invisibly.
      // The re-park now carries a `reparks` count (preserving the original sentinel payload); at the cap
      // it goes terminal (.failed + status), the same honest circuit breaker the pipeline itself uses.
      const reparks = (Number(o.reparks) || 0) + 1;
      const REPARK_MAX = 3;
      if (reparks >= REPARK_MAX) {
        const reasonText = `self-resume errored ${reparks}× — last: ${String(err?.message ?? err).slice(0, 300)}`;
        // — derived ONCE, outside both best-effort try blocks below, because both sinks need it:
        // the status write and the failure notice. Computing it inside the status `try` scoped it away
        // from the packet, which is the shape that had the packet re-cutting the string on its own.
        const rt = terminalReasonFields(reasonText);
        note(`[runner] self-resume ${o.codename} errored ${reparks}× (cap ${REPARK_MAX}) — terminal .failed, no more re-parks: ${err?.message ?? err}`);
        try {
          writeFileSync(join(o.runDir, ".failed"), JSON.stringify({ stage: "self-resume", reason: reasonText, reparks, ts: new Date().toISOString() }, null, 2) + "\n");
          try {
            const statusPath = join(o.runDir, "status.json");
            const status = JSON.parse(readFileSync(statusPath, "utf8"));
            // — cut VISIBLY. This is a terminal status write and it carried a bare 200-char slice,
            // so the cap that hides a cause hid it here too — and reasonText has already lost its own
            // tail to a 300-char slice one level up, which is the second cut nobody was told about.
            writeFileSync(statusPath, JSON.stringify({ ...status, state: "failed", failedStage: "self-resume", reason: rt.reason, reasonTruncated: rt.reasonTruncated, reasonFull: rt.reasonFull, sendPending: true }, null, 2) + "\n");
          } catch { /* status best-effort — the .failed sentinel is the durable record */ }
          // The failure NOTICE rides the same guaranteed lane as the pipeline's own terminal (
          // T5) — without it a capped re-park dies silently, the exact disease the cap exists to end.
          try {
            const runName = basename(o.runDir);   // "<date>-<codename>" — the dated tail of the canonical runId (charter P1 §3)
            const packet = buildFailurePacket({
              runId: `${basename(dirname(o.runDir))}-${runName}`, agent: o.agent, job: o.job,
              // — `rt` is computed four lines up for the status write; the packet re-cut the SAME
              // string with a bare slice, so the notice and status.json could disagree about whether the
              // sentence was finished. One cap, one marker, both sinks.
              failedStage: "self-resume", shortReason: rt.reason, reasonVerbatim: reasonText,
              terminalKind: "exhausted", priorAttempts: reparks,
            });
            try { rmSync(join(o.runDir, ".sent"), { force: true }); } catch { /* none */ }
            try { rmSync(driverDir(o.runDir, "send-receipts.json"), { force: true }); } catch { /* none */ }
            ensureDriverDir(o.runDir);
            writeFileSync(driverDir(o.runDir, "failure.json"), JSON.stringify(packet, null, 2) + "\n");
            mkdirSync(config.outboxDir, { recursive: true });
            writeFileSync(join(config.outboxDir, `${packet.runId}.pending`), `${o.agent}\n`);
          } catch { /* notice best-effort — .failed + status remain the record */ }
          rmSync(claimPath, { force: true }); rmSync(`${claimPath}.pid`, { force: true });
        } catch { /* best-effort */ }
      } else {
        note(`[runner] self-resume ${o.codename} errored (${err?.message ?? err}) — re-parking with a fresh backoff (${reparks}/${REPARK_MAX})`);
        // re-park resumable with postponedAt=now so a persistent error BACKS OFF instead of hot-looping each
        // tick. BOTH due-clock keys are nulled (A4 split: resetsAt = rate-limit cap, recoveryResumesAt =
        // recovery backoff) — the spread preserves the original sentinel payload, so a surviving
        // recoveryResumesAt from the recovery park would already be in the past and postponedDueAt would
        // read it as "due now", burning every re-park at tick cadence with no backoff at all.
        try {
          writeFileSync(join(o.runDir, ".postponed"), JSON.stringify({ ...(o.payload ?? {}), ts: new Date().toISOString(), resetsAt: null, recoveryResumesAt: null,
            postponedAt: new Date().toISOString(), fromStage: o.fromStage, codename: o.codename, job: o.job, agent: o.agent, reparks }, null, 2) + "\n");
          rmSync(claimPath, { force: true }); rmSync(`${claimPath}.pid`, { force: true });
        } catch { /* best-effort */ }
      }
    }
  }
}

// Serial claim+run of ONE job (prep then, if prepared, execute — awaited). Used by the crash-recovery path
// and the unit tests; equivalent to the pre-Phase-4 claimAndRun.
async function claimAndRun(jsonFile, qdir, agentId) {
  const prepared = await claimAndPrep(jsonFile, qdir, agentId);
  if (prepared) await runPrepared(prepared, qdir, agentId);
}

// A4 — a run counts as DELIVERED (do NOT re-run/re-handoff) the moment the delivery tail commits, not only
// once the `.delivered` sentinel lands LAST. The tail writes `_driver/delivery.json` + status.state
// "delivered" (report already published, delivery packet + outbox marker already dropped) sub-seconds
// before the sentinel; a crash in that window leaves a LIVE dir with no `.delivered`, and re-running it
// rm's `.sent`+receipts and re-hands-off → a duplicate report to the lawyer. Converge on the SAME
// delivered-check both the reclaim router and the pipeline resume guard consult (no new gate). Pure read.
/** Re-arm a delivery that was published but never announced (the crash window between
 *  _driver/delivery.json and status.sendPending). Idempotent and conservative:
 *   - `.sent` present  ⇒ the courier already sent it; touch nothing.
 *   - no delivery.json ⇒ nothing to announce (archived-without-packet, legacy run); touch nothing.
 *   - sendPending true ⇒ already armed; touch nothing.
 *  Otherwise set sendPending so the existing outbox rescan / completion-watch picks it up and sends
 *  exactly once (the run's own .sent guard remains the source of truth against double-sending).
 *  Exported for the test; returns what it did so callers can log it. */
export function armUnannouncedDelivery(runDir, label = "") {
  try {
    if (!existsSync(driverDir(runDir, "delivery.json"))) return "no-packet";
    if (existsSync(join(runDir, ".sent"))) return "already-sent";
    let status = {};
    try { status = JSON.parse(readFileSync(join(runDir, "status.json"), "utf8")); } catch { /* absent/corrupt ⇒ treat as unarmed */ }
    if (status?.sendPending === true) return "already-pending";
    const merged = { ...status, state: "delivered", sendPending: true, updatedAt: new Date().toISOString() };
    const tmp = join(runDir, `status.json.${process.pid}.${Date.now().toString(36)}.tmp`);
    writeFileSync(tmp, JSON.stringify(merged, null, 2) + "\n");
    renameSync(tmp, join(runDir, "status.json"));
    note(`[runner] ${label}: report was published but never announced (crash before the outbox marker) — re-armed sendPending so the backstop delivers it`);
    return "armed";
  } catch (e) {
    // Never let this break the reclaim: the run is already published, and a failure here leaves
    // exactly the state we started with rather than a wrong one.
    note(`[runner] ${label}: could not re-arm an unannounced delivery (${String(e?.message ?? e).slice(0, 120)})`);
    return "error";
  }
}

export function runDirDelivered(dir) {
  if (existsSync(join(dir, ".delivered"))) return true;
  if (existsSync(driverDir(dir, "delivery.json"))) return true;
  try { return JSON.parse(readFileSync(join(dir, "status.json"), "utf8"))?.state === "delivered"; } catch { return false; }
}

// B1 — where (if anywhere) a codename's run already lives on disk. The live leaf is "<date>-<codename>";
// when the dispatch dateISO is known (persisted in the meta BEFORE any spend, and equal to the run dir's
// own date prefix — buildRunContext built it with that date), match the EXACT `${dateISO}-${codename}`
// leaf. A date-agnostic `endsWith(-codename)` (the only option when dateISO is genuinely absent — legacy
// meta) would ALSO match a lingering same-slug run dir from an EARLIER date that happens to share today's
// random codename, and mis-route the reclaim: resume that stranger's stale dir, or consume a brand-new job
// as its `.done` "already-delivered" without ever running the client search (A2). The archive nests the
// same leaf under <YYYY-MM>/, keyed off the meta's dateISO month when present, else every month is scanned
// (one readdir per month — the archive is shallow). Pure read; exported for the crash-identity tests.
export function findRunDirFor({ codename, slug, dateISO = null, studioRoot, archiveRoot }) {
  const leaf = dateISO
    ? (n) => n === `${dateISO}-${codename}`
    : (n) => /^\d{4}-\d\d-\d\d-/.test(n) && n.endsWith(`-${codename}`);
  try {
    const hit = readdirSync(join(studioRoot, slug)).find(leaf);
    if (hit) return { kind: "live", dir: join(studioRoot, slug, hit) };
  } catch { /* no slug dir yet */ }
  let months = [];
  if (dateISO) months = [String(dateISO).slice(0, 7)];
  else { try { months = readdirSync(archiveRoot); } catch { /* no archive yet */ } }
  for (const m of months) {
    try {
      const hit = readdirSync(join(archiveRoot, m, slug)).find(leaf);
      if (hit) return { kind: "archived", dir: join(archiveRoot, m, slug, hit) };
    } catch { /* month/slug absent */ }
  }
  return null;
}

// Atomic takeover of a dead/over-age claimer's `.processing`. The old takeover was a plain
// writeFileSync of `.pid` — no mutual exclusion, so two runners whose reclaim scans overlapped (a
// .path-triggered systemd activation + a manual backlog drain, the exact scenario the liveness gate
// documents) could BOTH judge the claimer dead, both overwrite `.pid`, and both dispatch a RESUME of
// the same codename: a concurrent double-run of one run dir, invisible to the never-two-claims
// queue-marker invariant (both claims share the single `.processing`). The rename IS the lock (the
// codebase's claim idiom, single winner): rename the marker to a token-named `.claimed-` path,
// RE-VERIFY the claimer under the lock (a sibling may have COMPLETED its takeover between our liveness
// read and our rename — its fresh `.pid` is live, so we stand down), stamp our claim token, restore
// the marker. While the lock is held nothing else can touch `.pid`: every other writer (claimAndPrep,
// claimDuePostponed, a competing takeover) first needs a rename win on a marker that isn't there.
export function takeoverClaim(procPath, { maxClaimAgeMs = config.maxClaimAgeMs, isAlive = claimerIsAlive } = {}) {
  const token = claimToken();
  const lockPath = `${procPath}.claimed-${token}`;
  try { renameSync(procPath, lockPath); } catch { return false; }   // a sibling holds the lock (or the marker moved on)
  try {
    let rec = null;
    try { rec = parseClaimSidecar(readFileSync(`${procPath}.pid`, "utf8")); } catch { /* legacy — no sidecar */ }
    const overAge = maxClaimAgeMs > 0 && claimAgeMs(procPath, lockPath) > maxClaimAgeMs;
    if (!overAge && rec && isAlive(rec)) { renameSync(lockPath, procPath); return false; }   // a sibling's takeover completed first
    writeFileSync(`${procPath}.pid`, token);   // stamp BEFORE restoring — the marker reappears already covered live
    renameSync(lockPath, procPath);
    return true;
  } catch (e) {
    note(`[runner] takeover of ${basename(procPath)} failed midway (restoring): ${e?.message ?? e}`);
    try { renameSync(lockPath, procPath); } catch { /* already restored, or the sweep below recovers it */ }
    return false;
  }
}

// A runner that died BETWEEN takeoverClaim's two renames leaves `<base>.processing.claimed-<pid>:<starttime>`
// — invisible to every queue scan. Restore any whose takeover-er is provably dead (same fail-safe liveness
// polarity as claims); a LIVE token is a takeover in progress and is left alone.
export function sweepAbandonedTakeovers(qdir, { isAlive = claimerIsAlive } = {}) {
  let files = [];
  try { files = readdirSync(qdir); } catch { return; }
  for (const f of files) {
    const m = /^(.+\.processing)\.claimed-(\S+)$/.exec(f);
    if (!m) continue;
    const rec = parseClaimSidecar(m[2]);
    if (rec && isAlive(rec)) continue;
    note(`[runner] restoring ${m[1]} from an abandoned takeover (token ${m[2]})`);
    try { renameSync(join(qdir, f), join(qdir, m[1])); } catch { /* raced another sweeper — fine */ }
  }
}

// B1 — crash recovery for ONE queue dir: resolve every orphaned .processing whose claimer is dead. The
// dispatch wrote `<base>.processing.meta` = {codename, dateISO, agentId} BEFORE the pipeline started, so
// the dead claimer's run identity is recoverable — route by what that codename already owns on disk:
//   live run dir, not delivered → RESUME the same codename (returned for the admission loop to launch via
//                                 the resumeMeta path; idempotency skips every completed billable stage)
//   delivered / archived        → the lawyer already has the report (archived, `.delivered`, OR the tail's
//                                 delivery.json / status "delivered" — see runDirDelivered) — consume the
//                                 entry as .done, NEVER re-run (the post-delivery-pre-.done crash window;
//                                 one tail window double-delivered a full report exactly here)
//   nothing / no meta / corrupt → legacy fresh re-claim (rename back to .json for the admission loop)
// A LIVE claimer is skipped untouched — re-claiming an in-flight job would duplicate the run.
function reclaimOrphanedClaims(qdir, agentId) {
  const resumes = [];
  sweepAbandonedTakeovers(qdir);   // recover markers a takeover-er abandoned mid-rename before scanning
  for (const f of readdirSync(qdir).filter((f) => f.endsWith(".processing"))) {
    const base = f.replace(/\.processing$/, "");
    const procPath = join(qdir, f);
    let rec = null;
    try { rec = parseClaimSidecar(readFileSync(`${procPath}.pid`, "utf8")); } catch { /* legacy claim — re-claimable */ }
    // B2 — max claim age (of the CLAIM — the .pid sidecar's mtime, see claimAgeMs): over the ceiling the
    // claim re-claims REGARDLESS of the liveness verdict (the fail-safe unreadable-stat polarity above
    // needs this honest escape hatch, and a wedged-but-alive claimer must not park a client search forever).
    const ageMs = claimAgeMs(procPath);
    const overAge = config.maxClaimAgeMs > 0 && ageMs > config.maxClaimAgeMs;
    if (overAge) {
      note(`[runner] ${base} claim is ${Math.round(ageMs / 3600000)}h old (ceiling ${Math.round(config.maxClaimAgeMs / 3600000)}h) — re-claiming REGARDLESS of claimer liveness`);
    } else if (rec && claimerIsAlive(rec)) {
      // Repeated skips of one base are the wedge signature — tally them on a sidecar so each note carries
      // an escalating count the ops digest can pick up later (the digest side is not built here).
      let skips = 0;
      try { skips = Number(readFileSync(`${procPath}.skips`, "utf8").trim()) || 0; } catch { /* first skip */ }
      skips += 1;
      try { writeFileSync(`${procPath}.skips`, `${skips}\n`); } catch { /* best-effort */ }
      note(`[runner] ${base} is IN FLIGHT (claimer pid ${rec.pid}) — not re-claiming (skip #${skips}, claim age ${Math.round(ageMs / 60000)}m)`);
      continue;
    }
    // Dead (or over-age) claimer — take the claim over ATOMICALLY before routing it: only the rename
    // winner may consume/resume/re-open this job. Two overlapping reclaim scans used to both dispatch.
    if (!takeoverClaim(procPath)) {
      note(`[runner] ${base} takeover lost to a concurrent runner — leaving it to the winner`);
      continue;
    }
    let meta = null;
    try { meta = JSON.parse(readFileSync(`${procPath}.meta`, "utf8")); } catch { /* no/corrupt meta — legacy fresh re-claim */ }
    if (meta?.codename) {
      let job = null;
      try { job = assembleJob(procPath, qdir, base); } catch { /* malformed manifest — the .json path fails it at intake properly */ }
      const owned = job ? findRunDirFor({
        codename: meta.codename, slug: deriveSlug(job), dateISO: meta.dateISO ?? null,
        studioRoot: config.studioRootForAgent(agentId), archiveRoot: config.archiveRootForAgent(agentId),
      }) : null;
      if (owned && (owned.kind === "archived" || runDirDelivered(owned.dir))) {
        note(`[runner] ${base}: dead claimer but run ${meta.codename} already DELIVERED (${owned.kind}) — marking .done, NOT re-running`);
        // …but "delivered" here can mean "published and then the process died before it told anyone".
        // The pipeline writes _driver/delivery.json, THEN the outbox marker, THEN status.sendPending —
        // a crash inside that window leaves a finished report with no marker and no sendPending, so
        // every backstop (outbox rescan, completion-watch) scans past it and the client never receives
        // it, forever. Re-arming sendPending here is the one place that knows the run finished but was
        // never announced; .sent stays the idempotence guard, so an already-sent run is left alone.
        // Re-armed BEFORE the retire and deliberately not behind it: it is keyed by RUN DIR, not by the
        // queue path, it is `.sent`-guarded and idempotent, and a runner that loses the marker below has
        // still learned the one fact nothing else on disk records — that this report was published and
        // never announced. The winner takes this same branch and re-arms to the same value.
        armUnannouncedDelivery(owned.dir, base);
        // — this is the branch that exists BECAUSE one tail window double-delivered a full report,
        // and the unguarded sweep could put it back. Losing the rename to a sibling's takeover window
        // used to delete `.pid` and `.meta` anyway: the absent `.pid` is read under that sibling's lock
        // as a dead claim, so it stops standing down and WINS, and with `.meta` gone it finds no codename
        // and routes the already-delivered run to the legacy lane — back to `.json` as a fresh job, with
        // its prose parts deleted by the same sweep. Retire and sweep are one locked operation now.
        finishReclaimedClaim(procPath, qdir, base, "done", "already delivered",
          { ok: true, recovered: "already-delivered", codename: meta.codename, runDir: owned.dir });
        continue;
      }
      if (owned) {
        // ── A5 — BOUNDED reclaim (2026-07-28 postmortem): this lane had NO counter, so a run whose every resume
        // died the same death (an invalid artifact, a wedge that outlives the claimer) was re-driven at
        // every activation forever — the resume loop behind "running 7/9". The counter lives in the
        // identity meta (persisted at every dispatch, see runPrepared); past the cap the claim goes
        // TERMINAL with its artifacts kept, and the failure notice rides the same guaranteed packet
        // lane every other terminal uses — never a silent stall.
        const RECLAIM_MAX = 3;
        const priorReclaims = Number(meta.reclaims) || 0;
        if (priorReclaims >= RECLAIM_MAX) {
          const reasonText = `queue reclaim exhausted: ${priorReclaims} crash-reclaim resume(s) of ${meta.codename} already died without reaching a terminal (cap ${RECLAIM_MAX}) — ending the run instead of resuming again; artifacts kept in ${owned.dir}`;
          note(`[runner] ${base}: ${reasonText}`);
          try {
            writeFileSync(join(owned.dir, ".failed"), JSON.stringify({ stage: "queue-reclaim", reason: reasonText, reclaims: priorReclaims, terminalKind: "reclaim-exhausted", ts: new Date().toISOString() }, null, 2) + "\n");
            // — same three fields as every other terminal. The reclaim reason NAMES THE ARTIFACT
            // DIRECTORY at its end ("artifacts kept in <dir>"), which is precisely the pointer a 200-char
            // cut destroys and precisely what a reader of this status needs next.
            const rt = terminalReasonFields(reasonText);
            writeRunStatus(null, { state: "failed", failedStage: "queue-reclaim", reason: rt.reason, reasonTruncated: rt.reasonTruncated, reasonFull: rt.reasonFull, terminalKind: "reclaim-exhausted", sendPending: true }, owned.dir);
            try { runLog(owned.dir, { event: "failed", stage: "queue-reclaim", reason: reasonText, terminalKind: "reclaim-exhausted", reclaims: priorReclaims }); } catch { /* spine best-effort */ }
            // the guaranteed notice lane ( T5) — same packet shape as the pipeline's terminal
            const packet = buildFailurePacket({
              // canonical runId form (charter P1 §3): owned.dir's leaf is "<date>-<codename>"
              runId: `${deriveSlug(job)}-${basename(owned.dir)}`, agent: agentId, job, failedStage: "queue-reclaim",
              // — same string, same `rt` as the status write six lines up. This is the reason the
              // comment above calls out for NAMING THE ARTIFACT DIRECTORY at its end: the status field
              // was repaired by and the notice a human actually reads was left cutting it blind.
              shortReason: rt.reason, reasonVerbatim: reasonText, terminalKind: "reclaim-exhausted",
              priorAttempts: priorReclaims, whatsappTo: AGENT_WHATSAPP[agentId] ?? null,
            });
            try { rmSync(join(owned.dir, ".sent"), { force: true }); } catch { /* none */ }
            try { rmSync(driverDir(owned.dir, "send-receipts.json"), { force: true }); } catch { /* none */ }
            ensureDriverDir(owned.dir);
            writeFileSync(driverDir(owned.dir, "failure.json"), JSON.stringify(packet, null, 2) + "\n");
            mkdirSync(config.outboxDir, { recursive: true });
            writeFileSync(join(config.outboxDir, `${packet.runId}.pending`), `${agentId}\n`);
          } catch (e) { note(`[runner] ${base} reclaim-terminal bookkeeping failed (non-fatal — the queue marker still ends it): ${e?.message ?? e}`); }
          // — the packet block above stays FIRST (T5: the notice must never be able to go missing
          // behind a terminal marker), so the residual it carries is unchanged and pre-dates this: if the
          // retire below loses, a failure packet and an outbox `.pending` have already been written for a
          // job the winner owns. Reordering trades that for a crash window leaving `.failed` with no
          // notice on any lane, which is the silent stall this branch was built to prevent.
          //
          // What DOES move behind the retire: the sweep, the prose deletion, the `.result` and the
          // matter-ledger drop. The reclaim COUNTER lives in `.meta` (the whole point of the A5 cap), so
          // an unguarded sweep of a lost retire deleted the count of reclaims already spent — the next
          // activation reads 0 of 3 and the resume loop the cap bounds restarts from scratch. And
          // dropMatter marks the ledger row failed, which findDuplicateMatter skips, re-opening the gate
          // against a matter the winner may be mid-resume.
          finishReclaimedClaim(procPath, qdir, base, "failed", "reclaim exhausted",
            { ok: false, failedStage: "queue-reclaim", reason: reasonText, terminalKind: "reclaim-exhausted", codename: meta.codename, runDir: owned.dir },
            { dropMsgId: job.msgId });   // a reclaim-terminal must not block a genuine re-send of this matter
          continue;
        }
        const reclaims = priorReclaims + 1;
        // persist the incremented count BEFORE dispatching (a crash mid-resume must still see it spent)
        try {
          writeFileSync(`${procPath}.meta.tmp`, JSON.stringify({ ...meta, reclaims }, null, 2) + "\n");
          renameSync(`${procPath}.meta.tmp`, `${procPath}.meta`);
        } catch (e) { note(`[runner] ${base} reclaim-counter write failed (non-fatal): ${e?.message ?? e}`); }
        // the claim is already taken over in place (takeoverClaim stamped our live token; the job STAYS
        // .processing — no .json window a sibling could race)
        note(`[runner] re-claiming orphaned ${base} as a RESUME of ${meta.codename} (agent=${agentId}; completed stages skip; reclaim ${reclaims}/${RECLAIM_MAX})`);
        resumes.push({ prepared: { procPath, base, job }, meta: { codename: meta.codename, fromStage: null, dateISO: meta.dateISO ?? null, reclaims } });
        continue;
      }
    }
    note(`[runner] re-claiming orphaned ${base} (agent=${agentId})`);
    // item 2 — DECISION: a lost rename here does NOT retry, and recovery is left to the next
    // activation. The rename is lost only inside `takeoverClaim`'s two-rename window, which is another
    // runner holding the lock on this exact job; retrying would either lose the same race again or
    // succeed by stealing a marker that runner is mid-way through restoring. The next activation
    // re-claims the orphan on its own merits and the ledger stays single-writer. Stated rather than
    // fallen through, so a future reader knows nobody forgot to handle it.
    // — retire AND sweep under the claim lock, never as two steps. The sweep used to run whatever
    // the rename did, so a runner that lost this race went on to delete the `.pid`/`.meta`/`.skips` of
    // the claim the winner was taking over. retireClaimAndSweep deletes nothing unless it won the lock.
    const returned = retireClaimAndSweep(procPath, join(qdir, `${base}.json`), "orphan returned to the queue");
    if (!returned)
      note(`[runner] ${base} was NOT returned to the queue by this activation — another runner holds it; the next activation will re-claim it if it is still orphaned`);
  }
  return resumes;
}

// Drain ONE queue dir: re-claim orphaned .processing, then claim+run each queued .json as `agentId`.
async function drainQueue(qdir) {
  const agentId = config.agentIdFromQueueDir(qdir) ?? config.defaultAgent;
  mkdirSync(qdir, { recursive: true });
  // crash recovery, once, up front — dead-claimer resumes launch through the admission loop below so they
  // share the run-slot pool (and the admission gate) with fresh jobs. Skipped entirely once admission is
  // closed (budget or stop signal): orphans keep for the next activation.
  const reclaimedResumes = admitting() ? reclaimOrphanedClaims(qdir, agentId) : [];
  // CONTINUOUS ADMISSION (mid-flight pickup fix, 2026-06-18): keep RE-SCANNING the queue and launch newly
  // arrived `.json` — plus any rate-limit-postponed run whose window has elapsed — as run-slots free, until
  // the queue is drained AND nothing is in flight. Claim+dedup stays SERIAL (race-free matter-dedup); the
  // pipelines run CONCURRENTLY, bounded by the run-slot cap (acquireRunSlot). Previously this took a SINGLE
  // readdir snapshot and Promise.all-ed the whole batch, so — behind the oneshot service that can't start a
  // second instance while one is draining — a job arriving mid-batch waited for the ENTIRE in-flight batch
  // (then the next 90s timer tick) before it could start. Now a fresh arrival starts the moment a slot opens.
  const running = new Map();   // base -> settling promise (resolves, never rejects: errors are caught)
  const scanMs = Math.max(1000, Number(process.env.CLEAROTRON_QUEUE_SCAN_MS || 10000));
  const launch = (prepared, resumeMeta = null) => {
    const p = runPrepared(prepared, qdir, agentId, resumeMeta)
      .catch((e) => note(`[runner] ${prepared.base} run threw (isolated): ${e?.message ?? e}`))
      .finally(() => running.delete(prepared.base));
    running.set(prepared.base, p);
  };
  let admissionClosedNoted = false;
  let starvedNoted = false;
  for (;;) {
    // How many admittable `.json` this pass LEFT BEHIND. Governs the exit test at the bottom; stays 0
    // when admission is closed, because then nothing is admittable by definition.
    let unclaimed = 0;
    // Admission gate: past the budget OR on a stop signal (B6), claim NOTHING new (fresh .json OR due
    // .postponed) — just drain what's in flight and exit; the remaining queue retriggers/awaits the next
    // activation (see admissionOpen/installStopHandlers above).
    if (admitting()) {
      // Resumes stay UNCONDITIONAL and still precede fresh work, exactly as before — this is
      // already-started work, and reclaimedResumes are ALREADY `.processing` and cannot be un-claimed.
      // They take run slots like anything else, so they are COUNTED against the budget below rather
      // than gated by it.
      //
      // Counted-not-gated means a pass with more due resumes than slots launches them all, and the
      // surplus blocks inside acquireRunSlot. That does NOT reintroduce the invisibility this change
      // fixes: a resumed run has ALREADY RUN, so it has a run dir and a status.json (postponeRun
      // flips it to "postponed"), and the portal's live scan reads it as paused. Invisibility was only
      // ever a FRESH-job problem — a job with no run dir yet, which is precisely what is gated below.
      let resumed = 0;
      for (const r of reclaimedResumes.splice(0)) { launch(r.prepared, r.meta); resumed++; }   // B1 dead-claimer resumes (claimed up front)
      for (const { prepared, meta } of claimDuePostponed(qdir)) { launch(prepared, meta); resumed++; }

      // ── ADMIT ONLY WHAT CAN RUN ─────────────────────────────────────────────────────────────────
      // This scan used to claim EVERY `.json` in one pass, and each launched pipeline then blocked
      // inside acquireRunSlot — which is a spin-and-race on `wx` create polling every 15s, not a
      // queue. So the order jobs were claimed in had no bearing on the order they RAN in, and a job
      // waiting for a slot sat as `.processing` with no run dir yet: invisible to the portal's queued
      // scan (which reads bare `.json`) AND to its live scan (which needs status.json). Claiming at
      // most what is free fixes both at once — the order means something, and what is waiting still
      // looks queued.
      //
      // The count is ADVISORY (see slot-lock.freeSlots). The queue dirs drain concurrently and each
      // reads the same lock dir, so the sum of their budgets can exceed cap; an over-admitted job then
      // blocks inside acquireRunSlot exactly as every job did before. This degrades to the OLD
      // behaviour, never to a deadlock — which is why the budget is counted here and the slot is still
      // taken in pipeline(), rather than acquiring a handle here and threading it down.
      //
      // Read ONCE per pass and decremented locally: a job launched a moment ago has not reached
      // acquireRunSlot yet, so re-reading per claim would count the same free slot twice.
      let budget = Math.max(0, freeSlots({ dir: config.runLockDir, cap: config.maxConcurrentRuns }) - resumed);
      const queued = orderedQueueFiles(qdir, readdirSync(qdir).filter((f) => f.endsWith(".json")));
      unclaimed = queued.length;
      for (const f of queued) {
        if (!admitting()) break;   // the gate can close mid-scan — stop between claims, never mid-claim
        if (budget <= 0) break;    // out of slots — the rest stays `.json`: visible, and in order
        const prepared = await claimAndPrep(f, qdir, agentId);
        unclaimed--;               // claimed, or lost the race to a sibling — either way not ours to admit
        if (prepared) { launch(prepared); budget--; }
      }
      // "Queue held, no slot, nothing of ours running" is the one new state this change can sit in, so
      // it must be visible in the journal — but once per EPISODE, not once per 10s poll. Latching on
      // entry and releasing as soon as anything is in flight means a drain that starves, recovers and
      // starves again says so twice, which is the signal; a drain that starves for an hour says it once.
      if (running.size > 0) starvedNoted = false;
      else if (unclaimed > 0 && !starvedNoted) {
        starvedNoted = true;
        note(`[runner] ${unclaimed} job(s) queued in ${qdir} and no run slot free (cap ${config.maxConcurrentRuns}) — holding them queued rather than claiming; will admit as slots free`);
      }
    } else if (!admissionClosedNoted) {
      admissionClosedNoted = true;
      note(`[runner] ${admissionClosedWhy()} — not claiming new jobs in ${qdir}; finishing ${running.size} in flight, remaining queue keeps for the next activation`);
    }
    // DO NOT EXIT WITH ADMITTABLE WORK LEFT BEHIND. `running.size === 0` alone used to mean "drained",
    // because the scan above always claimed everything it saw. Now a pass that gets no slot launches
    // nothing, so that test on its own would return with jobs still sitting in the queue and leave them
    // to the next `.path`/timer activation — a silent stall under exactly the load this change exists
    // for. Keep polling while admission is open and admittable `.json` remain; the admission budget is
    // what ends it if slots never free.
    if (running.size === 0 && (unclaimed === 0 || !admitting())) break;
    // free a slot OR catch a new arrival: wake on the first pipeline to settle, or after a short poll.
    await Promise.race([...running.values(), delay(scanMs)]);
  }
}

// A PENDING WHAT-IF IS WORK, and it has to be counted here or it never runs. main()'s idle fast-path
// returns before the drain when this says no, and a what-if job sits inside a RUN DIR — invisible to the
// queue-dir scan below. The `.path` unit does not watch run dirs either, so a what-if's trigger is the
// 90s timer alone: it starts within a tick and a half rather than instantly, which is the right latency
// for an experiment and the wrong one for nothing else this file does. Stated because it is a difference
// an operator would otherwise have to infer from a delay.
function hasPendingWhatIf() {
  const now = Date.now();
  try { return liveRunDirs(agentStudioRoots()).some((d) => pendingWhatIf(d, { now }).length > 0); }
  catch { return false; }
}

function hasQueuedWork() {
  const now = Date.now();
  return config.queueDirs.some((q) => {
    try {
      return readdirSync(q).some((f) => {
        // an abandoned mid-takeover marker (`.processing.claimed-<token>`) is work: the drain's
        // sweepAbandonedTakeovers restores it — without this the idle fast-path would strand it forever.
        //
        //: deliberately NOT isLiveQueueMarker. That answers "is this entry live", and a `.postponed`
        // run is live — it has state on disk and it will resume. This answers a different question: "is
        // there work on THIS tick", and a park is work only once its window has elapsed, which the branch
        // below computes. Sharing one predicate here would keep the runner permanently un-idle for the
        // whole of a five-hour rate-limit park.
        if (f.endsWith(".json") || f.endsWith(".processing") || /\.processing\.claimed-/.test(f)) return true;
        // a rate-limit-postponed run is WORK again once its window elapses (so main()'s idle fast-path doesn't
        // skip the tick that should auto-resume it). SAME due-time computation as claimDuePostponed —
        // postponedDueAt is the single source of truth, so the idle gate and the resume gate never disagree
        // (a null-resetsAt run is NOT yet work until its postponedAt backoff elapses).
        if (f.endsWith(".postponed")) {
          try { const m = JSON.parse(readFileSync(join(q, `${f}.meta`), "utf8")); return postponedDueAt(m, config.rateLimitDefaultBackoffMs) <= now; }
          catch { return true; }
        }
        return false;
      });
    } catch { return false; } // queue dir not created yet
  });
}

export async function main({ once = true } = {}) {
  // `once:false` is the no-systemd deployment: loop instead of returning, and let the SAME per-activation
  // body below run once per tick. Delegated rather than inlined so the systemd path (once:true, always)
  // reads exactly as it did — see watch().
  if (!once) return await watch();
  // Arm the admission budget FIRST (activation start = now): everything claimed after this deadline
  // would risk running into the systemd TimeoutStartSec ceiling, so it stays queued for the next
  // activation instead. Env override is for tests; non-finite/non-positive values fall back.
  const budgetRaw = Number(process.env.CLEAROTRON_ADMISSION_BUDGET_MS ?? DEFAULT_ADMISSION_BUDGET_MS);
  admissionDeadline = Date.now() + (Number.isFinite(budgetRaw) && budgetRaw > 0 ? budgetRaw : DEFAULT_ADMISSION_BUDGET_MS);
  // Idle fast-path: with nothing queued, exit cheaply WITHOUT a gateway preflight. The 90s timer fires
  // constantly; this keeps an empty tick near-zero-cost and stops it from failing (exit 3) when the gateway
  // happens to be down but there's no work anyway. A DUE run-dir POSTPONED orphan counts as work too.
  const dueOrphans = scanDueRunDirOrphans();
  const whatIfDue = hasPendingWhatIf();
  if (!hasQueuedWork() && dueOrphans.length === 0 && !whatIfDue) return;
  // Deployment config check — this is the DEPLOYMENT entrypoint, the layer that owns "what is this
  // install's public hostname" (not the pipeline, which is also driven by tests and by --resume with no
  // deployment around it). Reports only: a missing hostname costs a link, not the deliverable, so it must
  // never gate the queue. Placed after the idle fast-path so an empty tick stays free.
  const depCfg = preflightDeploymentUrls();
  for (const m of depCfg.missing) note(`[runner] deployment config MISSING: ${m}`);
  for (const w of depCfg.warnings) note(`[runner] deployment config: ${w}`);
  // WS-C Goal 1: drain the agent queues CONCURRENTLY — one in-flight pipeline per agent (jobs WITHIN
  // a queue stay serial; claimAndRun loops per dir). This was the real parallelism lever: raising the
  // run-slot cap alone was a no-op while this loop awaited each queue in turn. allSettled, NOT all —
  // one queue's fs error must never kill sibling agents' expensive in-flight runs (their orphaned
  // .processing markers would re-claim into NEW codenames on the next tick = full re-spend). The
  // run-slot cap bounds total resource use regardless of queue count.
  const results = await Promise.allSettled(config.queueDirs.map((qdir) => drainQueue(qdir)));
  results.forEach((r, i) => {
    if (r.status === "rejected") note(`[runner] queue drain FAILED (isolated): ${config.queueDirs[i]}: ${r.reason?.message ?? r.reason}`);
  });
  // After the queue drain (so a queue-owned resume claims its codename first), self-resume run-dir POSTPONED
  // orphans (manual resumes the queue never sees). Re-scan so the dedup reflects what the drain just claimed.
  try {
    if (admitting()) { const fresh = scanDueRunDirOrphans(); if (fresh.length) await resumeRunDirOrphans(fresh); }
    else note(`[runner] ${admissionClosedWhy()} — leaving run-dir POSTPONED orphans for the next activation (90s timer)`);
  } catch (e) { note(`[runner] run-dir self-resume FAILED (isolated): ${e?.message ?? e}`); }
  // ── CLIENT WHAT-IFS, LAST ────────────────────────────────────────────────
  //
  // After every paid path, and gated by the same admission budget: an experiment is free work against a
  // run that already exists, so it must never delay a clearance's admission or a parked run's resume. It
  // takes no run-slot (whatif-worker.mjs states why) and is isolated like every other drain here — one
  // failed experiment must not touch a sibling agent's in-flight pipeline.
  try {
    if (!admitting()) note(`[runner] ${admissionClosedWhy()} — leaving pending what-ifs for the next activation`);
    else { const settled = await drainWhatIfQueues(agentStudioRoots()); if (settled.length) note(`[runner] settled ${settled.length} what-if job(s)`); }
  } catch (e) { note(`[runner] what-if drain FAILED (isolated): ${e?.message ?? e}`); }
}

// ── WATCH MODE — the trigger a machine without systemd does not otherwise have ────────────────────────
// Every recovery path in this file is complete and needs no changes: a rate-limit park writes `.postponed`
// with a self-contained resume payload, `hasQueuedWork` already counts a DUE park as work, and a dead
// claimer's `.processing.meta` already re-claims into the SAME codename instead of re-minting. All of them
// depend on something re-invoking main(), and on the VM that something is the `.path` unit plus the 90s
// timer. On a laptop it was nothing at all, so a run parked at 3am on a provider cap sat there forever and
// a run cut by a closed lid never came back. This loop is that missing re-invocation and nothing else: it
// calls main({ once: true }) — the identical entrypoint systemd calls — and owns only the question of WHEN.
//
// Cadence is the timer's own (OnUnitActiveSec=90s), so both deployments retry on the same clock. An idle
// tick is near-free: main()'s fast-path returns before the deployment and gateway preflights when nothing
// is queued and no park is due.
//
// AN INHERITED LIMIT THAT IS GONE, recorded because its absence is the change: main() used to exit the
// PROCESS (3) when a gateway preflight failed, so a gateway outage ended the loop as it ended an
// activation. deleted that preflight — nothing is asked to be reachable before a job is claimed —
// so the loop has no exit path but its own.
const WATCH_TICK_MS = 90_000;    // mirrors prelim-driver.timer's OnUnitActiveSec — one cadence, two deployments
const WATCH_SLICE_MS = 5_000;    // the longest we ever sleep in one go: the suspend detector's resolution
const WATCH_WAKE_JUMP_MS = 15_000;   // wall clock outrunning a slice by this much means the machine was asleep

// A REF'D timer, deliberately not the shared `delay()` above: delay() unrefs, and between ticks this sleep
// is the ONLY thing on the event loop, so an unref'd one would let node exit 0 after the first tick — the
// same trap the gateway-preflight hold documents.
const sleepRefd = (ms) => new Promise((r) => setTimeout(r, ms));

// WAKE FROM SUSPEND. A closed lid is the normal condition for a multi-hour job, and a single
// setTimeout(90s) handles it badly in both directions depending on the platform: timers run on a
// MONOTONIC clock that stops while a Linux laptop is suspended, while `resetsAt` and postponedDueAt are
// WALL-clock. So a park whose window elapsed during four hours of sleep is due the instant the machine
// wakes, and a naive interval either sleeps the full remainder past it or (where the platform's monotonic
// clock does advance through sleep) fires on time by luck. Neither is a promise. Instead the wait is
// sliced, and each slice compares wall-clock elapsed against what it asked for: a slice that overran by
// more than WATCH_WAKE_JUMP_MS is the signature of a suspend, so we stop waiting and tick immediately.
// The tick itself re-reads the clock through the existing postponedDueAt, so this only ever decides when
// to LOOK — never whether a run may proceed.
export async function watch({
  tickMs = WATCH_TICK_MS, sliceMs = WATCH_SLICE_MS, wakeJumpMs = WATCH_WAKE_JUMP_MS,
  ticks = Infinity, run = main, sleep = sleepRefd, now = () => Date.now(), stopped = stopRequested,
  // — injectable for the same reason every other dependency here is: the loop's arms drive it with a
  // fake clock and must not write to a real install.
  heartbeat = () => beat(config.runLockDir),
} = {}) {
  note(`[runner] watch: polling every ${Math.round(tickMs / 1000)}s (no systemd here); a due park or an unclaimed job is picked up on the next tick. Ctrl-C to stop.`);
  for (let n = 0; ; n++) {
    if (stopped()) break;
    // One bad tick must never end the loop — that would put us back where a laptop started, with nothing
    // re-invoking anything. main() already isolates per-queue failures; this catches everything above them.
    // — the beat goes BEFORE the tick's work, not after. The portal reads this to tell "waiting for
    // a worker that is not running" from "waiting its turn", and a beat written only on completion would
    // leave a freshly-started worker looking absent for its whole first tick — which is exactly the window
    // a user watches after pressing Start.
    heartbeat();
    try { await run({ once: true }); }
    catch (e) { note(`[runner] watch tick FAILED (isolated — retrying next tick): ${e?.message ?? e}`); }
    if (n + 1 >= ticks) break;
    const due = now() + tickMs;
    for (;;) {
      if (stopped()) break;
      const before = now();
      const asked = Math.min(sliceMs, due - before);
      if (asked <= 0) break;
      await sleep(asked);
      const elapsed = now() - before;
      if (elapsed > asked + wakeJumpMs) {
        note(`[runner] watch: ${Math.round(elapsed / 1000)}s of wall clock passed during a ${Math.round(asked / 1000)}s sleep — treating this as wake-from-suspend and ticking now, so a window that elapsed while asleep is not waited out again`);
        break;
      }
    }
  }
  note(`[runner] watch: stopped${stopSignal ? ` (${stopSignal})` : ""} — anything still parked resumes the next time this runs.`);
}

if (isEntrypoint(import.meta.url)) {
  // A retired variable must not go SILENT. This is the entrypoint that matters for it: prelim-driver.service
  // runs THIS file, so a stale CLEAROTRON_KNOCKOUT_MODE=1 in the EnvironmentFile is seen here and nowhere else —
  // the pipeline.mjs CLI is a manual tool an operator invokes by hand, and warning only there would have put
  // the notice everywhere except the process that actually reads the file carrying the line. stderr, so the
  // journal has it and no stdout consumer is disturbed. See RETIRED_ENV in pipeline.mjs for why this warns
  // rather than refuses.
  for (const w of retiredEnvWarnings()) console.error(w);
  installStopHandlers();   // B6 — mainline only (systemd/manual); in-process imports must not stack listeners
  // A FLAG, not an env var: watch mode is a property of how this process was launched, and a variable in an
  // EnvironmentFile could silently turn the systemd one-shot into a loop inside a Type=oneshot activation.
  // (It also stays clear of the undocumented-product-variable ratchet, which a CLEAROTRON_WATCH_* would trip.)
  //
  // An UNRECOGNISED token is refused rather than ignored, and here that is not pedantry: `--wach` would run
  // one tick, exit 0, and leave someone believing a watcher is running while nothing re-invokes anything —
  // the exact silence this whole change exists to remove. (pipeline.mjs's RETIRED_FLAGS table makes the same
  // argument about a switch that degrades quietly into whatever the remaining arguments mean.)
  const argv = process.argv.slice(2);
  const unknown = argv.filter((t) => t !== "--watch");
  if (unknown.length) {
    console.error(`error: unknown argument ${unknown[0]}\nusage: node runner.mjs [--watch]\n  --watch  keep polling instead of draining once — the substitute for the systemd .path/.timer units\n           on a machine that has none. Without it this drains the queue once and exits, which is what\n           systemd invokes.`);
    process.exit(2);
  }
  // ── — SAY WHICH BUILD THIS PROCESS HOLDS, BEFORE IT DRAINS ANYTHING ───────
  //
  // This process imports `pipeline` and calls it in-process: there is no fork per job, so it holds the
  // module graph it booted with until something restarts it. A deploy that moves the checkout does not
  // move it, and nothing on the box could previously tell. Health cannot interrogate a running process
  // for its loaded commit, so the process states it once, here, before any work.
  //
  // BEST-EFFORT AND NEVER FATAL — a drainer that cannot write its stamp still drains. The absence is a
  // finding where it is READ (scripts/live-surface-check.mjs), which costs no client a report.
  const watching = argv.includes("--watch");
  writeDrainerStamp(config.workspaceRoot, {
    ...identitySeed(),
    mode: watching ? "watch" : "once",
    startedAt: new Date().toISOString(),
    // The checkout THIS file was loaded from — not process.cwd(), which is whichever directory the
    // supervisor happened to start in and is a wrong answer rather than a missing one.
    checkout: join(dirname(fileURLToPath(import.meta.url)), ".."),
    argv: process.argv.slice(1).join(" "),
  });

  await main({ once: !watching });
}
