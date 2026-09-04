// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// lib/ops.mjs — the OPS write-face for the MCP server: start_run / stop_run / feed_context.
//
// ops-token-only (enforced centrally in scope.authorize — these are never reachable by a user/internal
// session). Writes ONLY within an agent's own prelim queue + run dirs (the same surface the runner already
// drains); shells nothing, spawns nothing. start_run enqueues a job the live runner picks up; stop_run
// dequeues a not-yet-claimed job (a real cancel) or files a cancel request for a running one; feed_context
// writes the late-bind applicant binding (customer-bind.json) the pipeline's pre-start bind already reads.

import { writeFileSync, existsSync, mkdirSync, rmSync, renameSync, readFileSync, readdirSync } from "node:fs";
import { join, basename } from "node:path";
import { driverDir, ensureDriverDir } from "../../shared/driver-dir.mjs";   // — one definition of where `_driver/` is
import { randomUUID } from "node:crypto";
import { config } from "./driver.mjs";
import { validateJob } from "../../driver/enqueue-schema.mjs";
import { doorGates } from "../../driver/door-gates.mjs";   // the resolved-product checks every door runs
import { probeQueueWatch, unwatchedQueueWarning } from "../../driver/queue-watch-probe.mjs";   //
import { resolveRun, runAccountKey } from "./runs.mjs";
import { assertAccountAccess, attributionOf } from "../../shared/scope.mjs";
import { requestCancel, isCancelled } from "../../driver/cancel.mjs";   // one marker shape, shared with the engine
import { readEngineChild, engineChildIsLive } from "../../driver/engine/child-record.mjs";   //
import { stopReason } from "../../shared/stop-reason.mjs";   //
import { envFrom } from "../../shared/env-aliases.mjs";   // — resolves EITHER spelling; names the retired one because that is the live-writable half

// Queue resolution (mirrors the enqueue CLI, docs/INTAKE.md): with NO explicit agent, a
// headless deployment's CLEAROTRON_QUEUE_DIR wins; otherwise the default agent's workspace queue. An
// EXPLICIT agent must actually exist — either the default agent or one with a real workspace queue —
// derived from config, never a hardcoded roster (the old closed set {clawdi, clawdi-alex, clawdi-sam}
// rejected every other deployment's agents).
function queueDir(agent) {
  if (!agent) {
    return envFrom(process.env, "CLEAROTRON_QUEUE_DIR") || config.queueDirForAgent(config.defaultAgent);
  }
  const q = config.queueDirForAgent(agent);
  if (agent !== config.defaultAgent && !existsSync(q)) {
    const known = [config.defaultAgent, ...config.queueDirs.map((d) => config.agentIdFromQueueDir(d)).filter(Boolean)];
    throw new Error(`unknown agent "${agent}" — no workspace queue exists for it (known: ${[...new Set(known)].join(", ")})`);
  }
  return q;
}

// The job start_run WOULD enqueue, built from tool args. Extracted so plan_run can preview the EXACT
// job start_run builds rather than a lookalike: a preview assembled by separate code is a preview that
// can drift from what actually runs, which is worse than no preview at all.
//
// Pure apart from the id/timestamp it mints. Does NOT validate, does NOT touch the queue.
// — the door token each verified principal enters through. EXPORTED so the value is testable and
// so a consumer needing "was this the portal?" reads one function rather than a string literal spelled
// in two places. The set is deliberately tiny: this names DOORS, and a new one is a decision somebody
// makes here rather than a sub that happens to arrive.
//
// `portal` is the sub bin/start.mjs mints for the portal's own trigger key (`--sub portal`, and
// docs/PORTAL.md prints the same command). Everything else is the MCP door proper: a connector, a
// staff key, an integrator — all of which reach start_run the same way and are told apart by
// `enqueuedBy`, which is what that field is for.
export const PORTAL_TOKEN_SUB = "portal";
export function enqueuedViaFor(scope) {
  return String(scope?.sub ?? "") === PORTAL_TOKEN_SUB ? "portal/start_run" : "mcp/start_run";
}

export function buildJob(args = {}, { scope } = {}) {
  // marks[] (search-depth spine): a knockout BATCH is ONE job carrying every mark — accept an explicit
  // marks array ({name, classes?, ref?} each) as the batch form; markName remains the single-mark form
  // (and defaults to the first batch mark for slug/display continuity).
  const marksIn = Array.isArray(args.marks)
    ? args.marks.map((m) => (m && typeof m === "object" ? { ref: m.ref || undefined, name: m.name != null ? String(m.name) : undefined, classes: Array.isArray(m.classes) ? m.classes.map(Number).filter(Number.isFinite) : undefined } : null)).filter((m) => m?.name)
    : null;
  if (!args.markName && !marksIn?.length) throw new Error("markName is required (or provide marks[] with named marks for a batch)");
  if (!args.forwarder) throw new Error("forwarder is required — the requester/reply-routing key that rides the delivery packet (docs/DELIVERY.md)");
  const id = String(args.id || `mcp-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`);
  // Input hardening: the id becomes a QUEUE FILENAME (join(qdir, `${id}.json`)) — a
  // path-shaped id would escape the queue directory. Slug-validated unconditionally, every caller.
  if (id !== basename(id) || id.includes("..") || !/^[A-Za-z0-9][A-Za-z0-9._@-]{0,127}$/.test(id))
    throw new Error(`id ${JSON.stringify(id)} must be a bare filename slug ([A-Za-z0-9._@-], no path separators)`);
  const classes = Array.isArray(args.classes) ? args.classes.map(Number).filter(Number.isFinite) : undefined;
  // `||` not `??`: markName "" is falsy-but-not-nullish and must fall through to the
  // first batch mark, never enqueue an empty display name.
  const markName = String(args.markName || marksIn?.[0]?.name);
  const job = {
    id,
    msgId: args.msgId || `<${id}@${process.env.TRADEMARK_MSGID_DOMAIN || "enqueue.local"}>`,
    conversationId: args.conversationId || id,
    forwarder: String(args.forwarder),
    forwarderEmail: args.forwarderEmail || `${args.forwarder}@example.com`,
    forwarderDomain: args.forwarderDomain || "example.com",
    provider: args.provider || undefined,
    ref: args.ref || undefined,
    markName,
    marks: (marksIn?.length ? marksIn : [{ ref: args.ref || undefined, name: markName, classes }]).map((m) => { const o = { ...m }; if (!o.classes) delete o.classes; if (!o.ref) delete o.ref; return o; }),
    classes,
    // The two selectors + route + lineage (validated by validateJob — an unknown product or recipe
    // throws at the door, before any queue write)
    product: args.product || undefined,
    recipeKey: args.recipeKey || undefined,
    deliveryRoute: args.deliveryRoute || undefined,
    parentRunId: args.parentRunId || undefined,
    customer: args.customer || undefined,
    profileKey: args.profileKey || undefined,
    // the project/engagement under the customer — its overlay rates the matter
    projectKey: args.projectKey || undefined,
    // per-run SCOPE — where the machinery points, as against the selectors above which choose WHICH
    // machinery runs. Passed through verbatim: validateJob owns the vocabulary (shape, caps, dedupe,
    // the bare-string normalization) so this door cannot drift from the CLI or the portal.
    jurisdictions: args.jurisdictions ?? undefined,
    // THE GEOGRAPHY STAMP. `worldwide` is a positive instruction that the account's own default
    // territories may not narrow — and without it, "search everywhere" and "I said nothing about
    // geography" are byte-identical on this wire, which is how a request that bought everywhere ran an
    // account's seven countries. validateJob refuses the contradiction (worldwide alongside named
    // territories) rather than picking a side, so this is carried verbatim and never reconciled here.
    geography: args.worldwide === true ? { mode: "worldwide", origin: "request" } : undefined,
    platforms: Array.isArray(args.platforms) ? args.platforms.map(String) : undefined,
    goods: args.goods || undefined,
    upfrontInstructions: args.upfrontInstructions || undefined,
    brief: args.brief || undefined,
    rawRequest: args.rawRequest || undefined,
    // full §B3 intake-fidelity passthrough (change-spec v3): posture + defaults the pipeline reads
    deliverableSpec: args.deliverableSpec || undefined,
    commercialFlexibility: args.commercialFlexibility || undefined,
    priorUse: args.priorUse || undefined,
    campaignShape: args.campaignShape || undefined,   // P2-C (Round-2 §8a): campaign-shape facts, verbatim
    deadline: args.deadline || undefined,
    // The ONE toggle in the offering. Additive-only, like the portal's own rule: it can add the
    // native-language investigation and can never take one away, so an explicit false would imply a
    // suppression that does not exist.
    // The one toggle in the offering, carried VERBATIM including `false`. The schema declares it a plain
    // boolean, so `false` is a shape an agent will send — and dropping it made this door one of four
    // that accepted a suppression request, recorded nothing, and ran the investigation anyway on the
    // product that carries it automatically. validateJob refuses it in products.mjs's own sentence.
    ...("nativeLanguage" in args && args.nativeLanguage != null ? { nativeLanguage: args.nativeLanguage } : {}),
    // `caseLaw` LEFT THE SCHEMA and is still carried, and the two go together. It is what a Full country
    // search IS, so it is not a field the tool offers — but an older client, a hand-rolled call or a
    // stored request will still send one, and dropping it here would make this the door that accepts the
    // field and silently ignores it. validateJob owns the vocabulary (see the note above); it refuses,
    // in the same sentence the portal and the CLI refuse with.
    ...("caseLaw" in args && args.caseLaw != null ? { caseLaw: args.caseLaw } : {}),
    ...("searchLevel" in args ? { searchLevel: args.searchLevel } : {}),   // presence, null included
    ...(args.customerUnknown === true ? { customerUnknown: true } : {}),
    ...(args.dupOverride === true ? { dupOverride: true } : {}),
    // The daily-allowance stamp, carried verbatim from the caller. Only the portal sets it, and only
    // for a verified client principal — see checkRunCaps. It can only ever ADD a cap to the run that
    // carries it, so a caller who sets it is restricting itself; absence is the uncapped default that
    // every staff, email and CLI job already relies on.
    ...(args.clientPrincipal === true ? { clientPrincipal: true } : {}),
    // — DECLARED IN `START_RUN_JOB_FIELDS.carries` SINCE THAT ISSUE, AND NEVER READ
    // HERE. `buildJob` is an allow-list that drops in silence what it does not name, so the operator
    // door declared it carried `demoRun` and did not: every `start_run` on a `demoData` account was
    // refused by `demoRunAgreement` with "cannot run a real clearance", and the one account that exists
    // to be demonstrated was the one account no door could start. Measured 2026-09-02 on
    // demo-brand-owner, through the portal, on a run the requester was watching.
    //
    // `=== true` and nothing looser, matching `demoRunShape`: a string or a number here is TRUTHY and
    // would mark a report as fiction on a value nobody typed deliberately.
    ...(args.demoRun === true ? { demoRun: true } : {}),
    enqueuedAt: new Date().toISOString(),
    // — THE FIELD WHOSE JOB IS TO SAY THE DOOR SAYS THE DOOR.
    //
    // This was the literal "mcp/start_run", so every portal-originated job recorded itself as MCP-door
    // traffic — the two production `portal-*` jobs carry exactly that. A provenance field that collapses
    // two doors into one value cannot support a per-door rule (rate limits, auth posture, audit) and
    // misattributes portal traffic in every consumer that trusts it.
    //
    // The answer was already on the job one line down. `enqueuedBy` carries the VERIFIED token sub, and
    // the portal's own key is minted `--sub portal` (bin/start.mjs, docs/PORTAL.md). So the door was
    // always identifiable — just never from the field that exists to name it, and reading two fields
    // together to answer one question is how the collapse survived.
    //
    // NO NEW TRUST BOUNDARY: this reads the same server-verified claim `enqueuedBy` already reads, at
    // the same moment. A caller cannot name its own door here any more than it could before — the
    // portal's sub is a MINTING convention, so a key minted `--sub portal` for something else stamps
    // `portal/start_run`, exactly as it already attributes that traffic to the portal in `enqueuedBy`.
    enqueuedVia: enqueuedViaFor(scope),
    // attribution: WHO triggered rides the job from the door — the VERIFIED principal
    // (token sub), server-stamped; a caller-supplied enqueuedBy is ignored by construction (not read).
    ...(scope?.sub ? { enqueuedBy: String(scope.sub) } : {}),
  };
  for (const k of Object.keys(job)) if (job[k] === undefined) delete job[k];
  return job;
}

/**
 * START_RUN'S HALF OF THE DECLARED-FIELD PARTITION (driver/enqueue-schema.mjs DECLARED_JOB_FIELDS).
 *
 * `buildJob` above is an allow-list and drops in silence what it does not name. This says the same list
 * out loud with a reason for every declared field left out, and doors-agree.test.mjs asserts the two
 * halves together are exactly the declared set — so a field declared tomorrow fails the suite until it is
 * classified here. plan_run reads the same builder, so this covers both MCP faces.
 */
export const START_RUN_JOB_FIELDS = Object.freeze({
  carries: Object.freeze([
    "id", "msgId", "conversationId", "forwarder", "forwarderEmail", "forwarderDomain", "provider",
    "ref", "markName", "marks", "classes", "goods",
    // — an OPERATOR door may declare a demo run; the client door may not.
    "demoRun",
    "jurisdictions", "platforms",
    // written from the `worldwide` argument, which is this door's wire name for the stamp: "everywhere"
    // and "I said nothing" are two different searches and only a positive instruction can tell them apart.
    "geography",
    "product", "recipeKey", "nativeLanguage", "caseLaw", "searchLevel", "deliveryRoute", "parentRunId",
    "customer", "profileKey", "projectKey", "customerUnknown",
    "upfrontInstructions", "brief", "rawRequest", "deliverableSpec", "commercialFlexibility",
    "priorUse", "campaignShape", "deadline",
    "dupOverride", "clientPrincipal", "enqueuedAt", "enqueuedVia",
    // the VERIFIED token sub, stamped server-side — a caller-supplied one is ignored by
    // construction, which is attribution the caller would otherwise be writing about themselves.
    "enqueuedBy",
  ]),
  notCarried: Object.freeze({
    registerFixtures: "a run that reads canned register payloads instead of calling a register. This door "
      + "starts real work for staff and agents; a fixture round is composed as job files by the e2e harness, "
      + "which writes the field directly rather than asking this tool for it (tracker issue 2038).",
    promptParts: "the requester's declaration that the prose rides as SIDECAR files. This door assembles from "
      + "structured tool input and writes no sidecars, so a job it built cannot be in that shape. Carrying it "
      + "would make the manifest claim an intake it did not use, and #1085's check would then report sidecars "
      + "missing on a job that never had any.",
    name: "the pre-markName spelling of the search subject. The schema offers markName/marks[]; a second "
      + "name field would give one door two answers to 'what is being cleared'.",
    use: "the pre-goods spelling of the goods description. Same reason as `name`.",
    tmp: "the pre-ref spelling of the reference number. Same reason as `name`.",
  }),
});

// The accounts-scoped rule shared by start_run and plan_run: name the account EXPLICITLY. The grant gate
// keys on profileKey, but the runner's forwarderDomain→matchDomains fallback could resolve a FOREIGN
// customer for an untagged job — closing the bypass at the door. plan_run enforces it
// too so a scoped caller cannot use the free preview to probe another customer's configuration.
export function assertScopedProfileKey(args, scope, verb) {
  if (Array.isArray(scope?.accounts) && !(args.profileKey && String(args.profileKey).trim()))
    throw new Error(`${verb}: an accounts-scoped session must set profileKey explicitly (domain-based customer resolution is not available to scoped tokens)`);
}

// start_run — enqueue a prelim job the runner will drain. Returns the queue id + slug; the runId/codename is
// assigned by the runner on claim, so the caller polls list_runs(slug) / run_changes for it.
export function startRun(args = {}, { scope } = {}) {
  const agent = args.agent ? String(args.agent) : "";
  assertScopedProfileKey(args, scope, "start_run");
  const qdir = queueDir(agent);
  // ONE builder shared with plan_run, so the preview a caller confirms is the job that actually runs.
  let job;
  try { job = buildJob(args, { scope }); }
  catch (e) { throw new Error(`start_run: ${e.message}`); }
  const { id } = job;

  const v = validateJob(job);
  if (v.classify === "reject" || !v.ok) {
    // The joined sentence stays — it is what an assistant reads out — but the refusals also ride as an
    // ARRAY on the error. A caller comparing this door's answer to the portal's had only the glued
    // string, and the glue is "; ", which occurs inside the refusals themselves: "…one name at a time;
    // send one search per name…" splits into two sentences that match nothing. A refusal that cannot be
    // compared cannot be shown to agree with another door's.
    const e = new Error(`start_run: job rejected — ${(v.errors || []).join("; ")}`);
    e.errors = v.errors || [];
    e.classify = v.classify;
    throw e;
  }
  // THE RESOLVED PRODUCT'S OWN CHECKS. validateJob judges what the request STATES; this door was
  // queueing requests whose product only exists once the account's profile is read — a two-name
  // clearance under a profile default, a native-language toggle on a product that does not carry it, a
  // Full country search over an account's seven default territories — and the runner refused them hours
  // later at claim, in sentences this caller never saw. Same fold as the portal, plan_run and the CLI,
  // and the refusals ride as an ARRAY for the same reason validateJob's do: the joined string's glue
  // ("; ") occurs inside the sentences themselves.
  const gates = doorGates(job);
  if (gates.errors.length) {
    const e = new Error(`start_run: job rejected — ${gates.errors.join("; ")}`);
    e.errors = gates.errors;
    e.classify = "clarify";
    throw e;
  }

  mkdirSync(qdir, { recursive: true });
  const tmp = join(qdir, `${id}.json.tmp`);
  const dest = join(qdir, `${id}.json`);
  if (existsSync(dest) || existsSync(join(qdir, `${id}.processing`))) throw new Error(`start_run: a job with id "${id}" is already queued/processing`);
  writeFileSync(tmp, JSON.stringify(job, null, 2) + "\n");
  renameSync(tmp, dest);                     // atomic publish (the runner claims *.json)
  // — this door has no stderr a requester ever sees, so the ACCEPTANCE carries the warning. It
  // rides `warnings`, which the caller already surfaces, rather than a new field nothing reads.
  const watch = probeQueueWatch({ queueDirs: [qdir] });
  return {
    ok: true, id, agent: agent || config.defaultAgent, queue: qdir, queued: true, classify: v.classify,
    warnings: [...(v.warnings || []), ...gates.warnings,
      ...(watch.state === "fail" ? [unwatchedQueueWarning(qdir, watch.unitPath)] : [])],
    queuePath: dest, queueWatched: watch.state,
    note: "Queued. The runner assigns a runId/codename on claim — poll list_runs (filter by markName) or run_changes for progress.",
  };
}

// stop_run — cancel. A not-yet-claimed queue job is removed (a REAL cancel before any spend). A running run
// gets a .cancel sentinel + honest status (in-flight turns are not force-killed from here). id cancels by
// queue id; runId cancels a started run.
export function stopRun(args = {}, { scope } = {}) {
  const agent = args.agent ? String(args.agent) : "";
  if (args.id) {
    const qdir = queueDir(agent);
    // same filename hardening as start_run — the id is joined into the queue path
    const sid = String(args.id);
    if (sid !== basename(sid) || sid.includes("..") || !/^[A-Za-z0-9][A-Za-z0-9._@-]{0,127}$/.test(sid))
      throw new Error(`stop_run: id ${JSON.stringify(sid)} must be a bare filename slug ([A-Za-z0-9._@-], no path separators)`);
    const f = join(qdir, `${String(args.id)}.json`);
    const NOT_FOUND = { ok: false, action: "not-found", id: args.id, note: "No queued job with that id (already run, or never queued)." };
    // ACCOUNT GATE: the runId form is gated at the dispatch chokepoint, but a QUEUED job
    // has no run yet — an accounts-scoped session may only touch jobs inside its grant, and a FOREIGN
    // job answers exactly like a nonexistent one (existence/ownership never leak; the old deny named
    // the owning account and the .processing branch was ungated). The manifest's
    // profileKey is the account (absent = "generic"); unreadable fails CLOSED for scoped sessions.
    const scopedOut = (file) => {
      if (!Array.isArray(scope?.accounts)) return false;
      let jobAccount = null;
      try { jobAccount = JSON.parse(readFileSync(file, "utf8")).profileKey ?? "generic"; } catch { jobAccount = null; }
      try { assertAccountAccess(scope, jobAccount, `queued job "${args.id}"`); return false; } catch { return true; }
    };
    if (existsSync(f)) {
      if (scopedOut(f)) return NOT_FOUND;
      rmSync(f, { force: true }); return { ok: true, action: "dequeued", id: args.id, note: "Removed from the queue before the runner claimed it — no spend." };
    }
    const proc = join(qdir, `${String(args.id)}.processing`);
    if (existsSync(proc)) {
      if (scopedOut(proc)) return NOT_FOUND;
      return { ok: false, action: "already-claimed", id: args.id, note: "Already claimed by the runner; pass runId to file a cancel request for the in-flight run." };
    }
    return NOT_FOUND;
  }
  if (args.runId) {
    const run = resolveRun(String(args.runId));
    if (!run) throw new Error(`stop_run: run "${args.runId}" not found`);
    // Terminal states have nothing to stop. PAUSED ONES DO — and this used to refuse them, which was
    // exactly backwards: a rate-limit park can sit for hours, and that is precisely when someone gives
    // up and presses Stop.
    if (run.state === "delivered" || run.state === "failed" || run.state === "cancelled")
      return { ok: false, action: "noop", runId: run.runId, state: run.state, note: `Run is ${run.state}; nothing to cancel.` };

    // WHO, not just HOW. `via` is true of every UI stop ever made; the session already holds the
    // verified identity, and this was throwing it away.
    //
    // naming half — the session's verified identity is the PORTAL on every UI stop, because the
    // portal calls with one ops token for every human behind it. `onBehalfOf` is the human it says it
    // verified; attributionOf keeps both, so the record never presents an asserted name as a proved one.
    const by = attributionOf(scope, args.onBehalfOf);
    // A SECOND PRESS IS ANSWERED, NOT RE-FILED. The owner pressed Stop, saw no
    // change, and pressed again — each press filed another request against a run already stopping.
    // requestCancel is idempotent about the MARKER; this makes the ANSWER idempotent too, so the
    // caller can say "already stopping since <ts>" instead of implying a fresh act.
    const alreadyStopping = isCancelled(run.runDir);
    const rec = requestCancel(run.runDir, { via: "mcp/stop_run", by });

    // ── — IMMEDIATE MODE: SENTINEL FIRST, THEN THE SIGNAL ─────────────────────
    //
    // Owner ruling, on his second encounter with the same wait: "a stop is a stop — maybe it should be
    // a 'stop immediately or at next boundary to preserve data' kind of question when you press it."
    // The boundary stop is unchanged and stays the default; this is the other half of the choice.
    //
    // THE ORDER IS THE SAFETY, and it is why the kill is HERE and not before requestCancel. The
    // sentinel is what makes the kill clean: the gateway finds an already-recorded cancel instead of an
    // unexplained dead child, and writes a proper terminal with attribution rather than the
    // `state:running` orphan. A kill without the sentinel first is the unsafe version.
    // Measured on the owner's own run 2026-09-02: sentinel, then SIGTERM to the engine child, terminal
    // in THREE SECONDS with state=cancelled, the stage named, the actor and request time carried, and
    // the token receipt preserved.
    //
    // THE CHILD, NEVER THE RUNNER. Killing the runner cannot produce that record — the thing that
    // writes the terminal would be the thing that died — and on a `--watch` drainer it ends every other
    // run that process is draining. "Stop this run" has to mean this run.
    //
    // AND NEVER A PATTERN MATCH. The child's argv names its run and stage, which makes "find the claude
    // process mentioning this run dir" look reasonable; it is the exact match the box rule forbids,
    // because several deployments share this box under different users and a `claude` process here can
    // belong to somebody else's work entirely.
    let immediate = null;
    if (args.immediate === true) {
      const child = readEngineChild(run.runDir);
      if (!child) {
        // NOTHING RECORDED IS NOT AN ERROR and must not become a search. A run between turns, or one
        // that predates the recording, simply has no turn to end — the cancel stands and the
        // cooperative stop takes it at the boundary. Said out loud, because a silent fallback here
        // reads to the presser as the immediate stop they asked for.
        immediate = { attempted: false, why: "no engine turn is recorded for this run — the cancel stands and will be taken at the next boundary" };
      } else if (!engineChildIsLive(child)) {
        // The pid is recorded but is not that process any more: it exited, or the pid was reused. Both
        // resolve to "there is nothing of this run's to signal", and signalling anyway is how a stop
        // kills a stranger. This is acceptance 5's already-exited case.
        immediate = { attempted: false, why: "the recorded engine turn has already exited — the cancel stands", pid: child.pid };
      } else {
        try {
          process.kill(child.pid, "SIGTERM");
          immediate = { attempted: true, signalled: "SIGTERM", pid: child.pid };
        } catch (e) {
          // ESRCH — it died between the liveness read and the signal, which is a race we lose harmlessly.
          // EPERM — it is not ours to signal, which is a real finding and must not read as success.
          immediate = { attempted: true, signalled: null, pid: child.pid, error: e?.code ?? String(e?.message ?? e) };
        }
      }
    }

    // A PARKED run has NO TURN IN FLIGHT, so the driver's honour check — which fires between turns —
    // will never run for it. Nothing would ever write the terminal, and the run would read "Paused"
    // on the portal forever. So the terminal is written HERE, from the only side that knows.
    //
    // Writing status.json from outside writeRunStatus is in-idiom: postponeRun, backstopFailureNotice
    // and the repark-cap terminal all do it. The queue-side `.postponed` marker is retired separately,
    // by the runner's claimDuePostponed, which reads the same `.cancel` marker.
    if (run.state === "postponed" || run.state === "recovering" || run.state === "parked-for-human") {
      let wrote = false;
      try {
        const sp = join(run.runDir, "status.json");
        const s = JSON.parse(readFileSync(sp, "utf8"));
        // BOTH due-clock keys are cleared (A4 split: resetsAt = rate-limit cap, recoveryResumesAt =
        // recovery backoff) — a cancelled recovery-parked run must not keep a stale resume clock.
        // — the sidecar written just below already carried `via`/`by`; status.json nulled it, so a
        // reader holding status.json ALONE could not tell this from a crash. Same facts, same builder.
        s.state = "cancelled";
        s.reason = stopReason({ stage: "parked", via: "mcp/stop_run", by, requestedAt: rec?.ts ?? null });
        s.resetsAt = null; s.recoveryResumesAt = null; s.updatedAt = new Date().toISOString();
        writeFileSync(sp, JSON.stringify(s, null, 2) + "\n");
        wrote = true;
      } catch { /* best-effort — the .cancel marker is the source of truth and every resume path reads it */ }
      try { writeFileSync(join(run.runDir, ".cancelled"), JSON.stringify({ stage: "parked", requestedAt: rec?.ts ?? null, via: "mcp/stop_run", by }) + "\n"); } catch { /* best-effort */ }
      return { ok: true, action: "cancelled", runId: run.runId, state: "cancelled", statusWritten: wrote, immediate,
        note: "Stopped while parked. It was waiting, not working, so nothing was in flight to interrupt and no further spend was possible." };
    }

    // RUNNING: the engine honours the marker at its next turn boundary. Deliberately not instant —
    // the run is a detached process tree the MCP cannot signal, and a turn already dispatched finishes.
    //
    // THE REQUEST BECOMES A STATE THE RUN CARRIES: stopRequestedAt rides
    // status.json as an ADDITIVE key — writeRunStatus spread-merges, so every later progress write
    // preserves it, and the driver's honour check replaces the whole story with the terminal. state
    // stays "running", because that is true; the SCREEN derives "Stopping…" from the pair. Best-effort
    // like the parked branch: the .cancel marker is the source of truth on every resume path.
    if (!alreadyStopping) {
      try {
        const sp = join(run.runDir, "status.json");
        const s = JSON.parse(readFileSync(sp, "utf8"));
        s.stopRequestedAt = rec?.ts ?? new Date().toISOString();
        s.updatedAt = new Date().toISOString();
        writeFileSync(sp, JSON.stringify(s, null, 2) + "\n");
      } catch { /* the marker still stops the run; the screen just cannot show the wait */ }
    }
    // — the ANSWER says which stop is in progress, because "Stopping…" that does not
    // distinguish them is the state the owner already told us says nothing. A pressed-immediate that
    // could not find a turn to end is reported as the boundary stop it actually became; presenting it
    // as an immediate stop would be the second silent thing in a row on the same control.
    if (alreadyStopping) {
      return { ok: true, action: "already-stopping", runId: run.runId, requestedAt: rec?.ts ?? null, immediate,
        note: immediate?.attempted
          ? `Already stopping — the request was filed at ${rec?.ts ?? "an earlier press"}, and the step in flight has now been ended. The run goes terminal in seconds.`
          : `Already stopping — the request was filed at ${rec?.ts ?? "an earlier press"} and the step in flight is being allowed to finish. Pressing again changes nothing.` };
    }
    if (immediate?.attempted && immediate.signalled)
      return { ok: true, action: "cancel-requested", runId: run.runId, requestedAt: rec?.ts ?? null, immediate,
        note: "Stopping now. The step in flight has been ended rather than allowed to finish, so the run goes terminal in seconds. What that step had already spent is spent, and everything recorded before it is kept." };
    if (args.immediate === true)
      return { ok: true, action: "cancel-requested", runId: run.runId, requestedAt: rec?.ts ?? null, immediate,
        note: `Stopping at the next step boundary. An immediate stop was asked for and could not be made: ${immediate?.why ?? immediate?.error ?? "the step in flight could not be ended"}. A step already under way finishes first. Nothing will be delivered.` };
    return { ok: true, action: "cancel-requested", runId: run.runId, requestedAt: rec?.ts ?? null,
      note: "Stopping. The run ends at its next step boundary; a step already under way finishes first, and what it has already spent is spent. Nothing will be delivered." };
  }
  throw new Error("stop_run: pass id (a queued job) or runId (a started run)");
}

// ── The PURE-MCP integrator loop (docs/DELIVERY.md) ────────────────────────────────────────────────
// An agent-platform integrator with NO filesystem access drives the whole delivery side over MCP:
//   list_outbox_events → get_delivery_packet → send → mark_sent → ack_event
// The outbox stays the source files; these verbs are its API face.

// list_outbox_events — discovery read: every *.pending in the outbox, parsed. JSON event packets
// return their full self-contained content; the legacy delivered marker (agent-id text body) is
// normalized to {kind:"delivered", runId} from its filename. Read-only; ack_event consumes.
export function listOutboxEvents() {
  let names = [];
  try { names = readdirSync(config.outboxDir).filter((f) => f.endsWith(".pending")); } catch { /* no outbox yet */ }
  const events = names.sort().map((file) => {
    let raw;
    try { raw = readFileSync(join(config.outboxDir, file), "utf8"); } catch { return null; } // raced an ack — skip
    try { return { file, ...JSON.parse(raw) }; }
    catch { return { file, kind: "delivered", runId: file.replace(/\.pending$/, ""), agent: raw.trim() || null }; }
  }).filter(Boolean);
  return { ok: true, count: events.length, events };
}

// get_delivery_packet — the run's send payload(s): _driver/delivery.json (success) and/or
// _driver/failure.json, plus the send-state the courier needs (sendPending, .sent). NOT client-safe:
// the packet carries recipient routing + the full email body.
export function getDeliveryPacket(args = {}) {
  if (!args.runId) throw new Error("get_delivery_packet: runId is required");
  const run = resolveRun(String(args.runId));
  if (!run) throw new Error(`get_delivery_packet: run "${args.runId}" not found`);
  const read = (n) => { try { return JSON.parse(readFileSync(driverDir(run.runDir, n), "utf8")); } catch { return null; } };
  const delivery = read("delivery.json");
  const failure = read("failure.json");
  if (!delivery && !failure)
    throw new Error(`get_delivery_packet: run "${run.runId}" has no delivery/failure packet (still running, or a legacy stage-mode run)`);
  return {
    ok: true, runId: run.runId, state: run.state,
    sendPending: run.status?.sendPending ?? null, sent: existsSync(join(run.runDir, ".sent")),
    delivery, failure,
  };
}

// ack_event — consume ONE outbox event after routing it (the integrator's marker-clear for the
// non-delivered kinds; the delivered marker is cleared by mark_sent). Idempotent: an already-gone
// file returns ok+alreadyGone. The name is validated as a bare *.pending basename — never a path.
//
// ACCOUNT GATE (GRANTS, INSTALL.md §8 — fix-list A3). Every OTHER write verb is account-gated:
// start_run on args.profileKey (scope.authorize), mark_sent / feed_context / the runId form of
// stop_run at the server.mjs dispatch chokepoint (which only fires when `authedArgs.runId != null`),
// and the QUEUE-id form of stop_run right here in this file. ack_event was the one write addressed by
// a FILENAME, so it carried no runId into the chokepoint and fell through every one of those gates:
// an accounts-scoped ops token could DESTROY the outbox marker of a customer outside its grant, and
// the event — a delivered marker, a run-failed packet, an intake rejection — would simply never be
// routed to anyone. Not reachable from the portal today (that token is verb-scoped to start_run
// only), so this is defence in depth rather than a live breach; the gate belongs here regardless.
//
// The refusal SHAPE is forced, not a style choice. A foreign event must answer BYTE-IDENTICALLY to a
// file that is not there — otherwise a scoped caller distinguishes "exists but is not mine" from
// "does not exist" and has an existence oracle over other customers' runs. That is the same doctrine
// stop_run's queue form states above ("a FOREIGN job answers exactly like a nonexistent one" —
// the old deny named the owning account). So a foreign event returns
// {ok:true, alreadyGone:true} and, critically, is NOT deleted.
//
// "alreadyGone" is therefore true WITHIN THE CALLER'S GRANT, which is the only universe a scoped
// session has: list_outbox_events already account-filters (server.mjs filterByAccounts), so a scoped
// courier never SAW this event and cannot be misled into thinking it routed one it did not. Leaving
// the file on disk is the point — the full-grant courier still picks it up.
//
// Fail closed on every unknown: a packet with no runId (an intake rejection filed before any run
// exists), an unreadable file, or a run with no account tag all resolve to "not in your grant" for a
// scoped session — exactly how assertAccountAccess already treats an untagged run everywhere else.
export function ackEvent(args = {}, { scope } = {}) {
  const file = String(args.file || "");
  if (!file) throw new Error("ack_event: file is required (from list_outbox_events)");
  if (file !== basename(file) || !file.endsWith(".pending"))
    throw new Error("ack_event: file must be a bare *.pending name exactly as list_outbox_events returned it");
  const p = join(config.outboxDir, file);
  const ABSENT = { ok: true, file, alreadyGone: true };   // the one answer a scoped caller may ever see for a foreign event
  if (!existsSync(p)) return ABSENT;
  if (Array.isArray(scope?.accounts) && !ackVisible(p, file, scope)) return ABSENT;
  rmSync(p, { force: true });
  return { ok: true, file, alreadyGone: false };
}

// Is this outbox event inside the scoped session's grant? Resolves the event's run EXACTLY as
// listOutboxEvents does — the JSON packet's `runId`, else the delivered marker's filename minus
// `.pending` — so the gate and the listing can never disagree about which run a file belongs to
// (a second, cleverer parser here would be a place for them to drift apart). Any failure to resolve
// is a refusal, never a pass.
function ackVisible(path, file, scope) {
  let runId = null;
  try {
    const raw = readFileSync(path, "utf8");
    try { runId = JSON.parse(raw).runId ?? null; }
    catch { runId = file.replace(/\.pending$/, ""); }     // legacy delivered marker: agent-id text body, runId in the name
  } catch { return false; }                                // unreadable — fail CLOSED
  if (!runId) return false;
  const run = resolveRun(String(runId));
  if (!run) return false;
  try { assertAccountAccess(scope, runAccountKey(run), `outbox event "${file}"`); return true; }
  catch { return false; }
}

// mark_sent — the integrator's DELIVERY WRITE-BACK (docs/DELIVERY.md step 3) as an MCP verb: an agent
// integrator (whose file sandbox cannot reach the product's run dirs) confirms it sent the delivered
// packet. Writes the .sent idempotency guard + flips status.json sendPending + best-effort clears the
// outbox marker. IDEMPOTENT courier semantics: an already-.sent run returns ok+alreadySent (never an
// error — a retried courier must not treat its own success as failure).
//
// A FAILURE NOTICE SETTLES THROUGH THIS SAME DOOR, and until now it could not.
//
// When a run dies, the backstop lane deliberately gives the notice the same guaranteed treatment as a
// delivery ( T5): a code-authored packet, status.sendPending = true, and a `<runId>.pending` wake
// marker — "the failure NOTICE rides the SAME guaranteed lane as success delivery". The courier then sends
// it and calls mark_sent to settle, exactly as it does for a delivery.
//
// It threw. The packet it looked for was `_driver/delivery.json`, and a failed run has never had one — it
// has `_driver/failure.json`. So the courier's settle call errored, `.sent` was never written, sendPending
// stayed true, and outbox-backoff re-dropped the marker on its next sweep ("status.sendPending === true and
// no .sent" is precisely its re-arm condition). The client gets the same failure notice again, and again,
// until a person deletes the marker by hand. The lane built so a failure could never be silent instead made
// it impossible to quieten.
//
// So the packet is EITHER. Nothing else changes: the same .sent guard, the same atomic sendPending flip,
// the same idempotent marker cleanup. Delivery is checked first so a run that failed, was repaired and
// then delivered settles against its delivery — the newer, truer record of what the reader received.
export function markSent(args = {}) {
  if (!args.runId) throw new Error("mark_sent: runId is required");
  const run = resolveRun(String(args.runId));
  if (!run) throw new Error(`mark_sent: run "${args.runId}" not found`);
  const deliveryPath = driverDir(run.runDir, "delivery.json");
  const failurePath = driverDir(run.runDir, "failure.json");
  const packetPath = existsSync(deliveryPath) ? deliveryPath : failurePath;
  if (!existsSync(packetPath))
    throw new Error(`mark_sent: run "${run.runId}" has no delivery or failure packet — nothing was pending a send`);
  // Clear the delivered outbox marker (edge-trigger only; a missing marker is a no-op). Runs on BOTH the
  // fresh and the alreadySent paths: the .sent guard is written BEFORE this removal, so a first call
  // interrupted (deliver-trigger.sh SIGKILLs the wake at 840s) between the two used to orphan the marker
  // forever — the alreadySent early-return then suppressed every retry of this cleanup. Making the
  // removal idempotent lets a retried mark_sent finish the cleanup a killed first call left undone.
  //
  // EVERY FORM THE RUN WAS EVER KNOWN BY, not just one (post-merge audit 2). A pre- packet carries the
  // legacy dateless `<slug>-<codename>` runId while the resolved run's own id is the dated canonical
  // `<slug>-<date>-<codename>` — a run delivered on 2026-07-29 still has exactly that pair on disk, its
  // _driver/delivery.json naming the dateless form and its status.json the dated one. That is also why
  // resolveRun keeps its historical dateless arm (runs.mjs), so both ids reach this function.
  // Removing only the packet's form left the OTHER form's marker on disk, and the outbox re-fires on
  // whatever is there; worse, the alreadySent early-return repeated the same single-form removal, so no
  // retry could ever finish the cleanup — the orphan was permanent. Same dual-form defence rescanOwedRuns
  // already applies when it decides a marker is already queued (charter P1 §3): one settle clears every
  // name that delivery could have been minted under. Best-effort per form; a missing one is a no-op.
  const clearMarker = () => {
    const packet = (() => { try { return JSON.parse(readFileSync(packetPath, "utf8")); } catch { return {}; } })();
    const sanitize = (s) => String(s).replace(/[^A-Za-z0-9._-]/g, "_");   // rescanOwedRuns' own marker-name gate
    // The three OBSERVED ids are not the whole set: rescanOwedRuns DERIVES the legacy
    // `<slug>-<codename>` form (outbox-backoff.mjs), and a marker minted under that name is named by
    // none of them when the packet was rewritten with the dated id after its marker was minted. That
    // orphan is not permanent — the courier re-passes the marker's own name next pass — but it costs a
    // RE-SEND, i.e. a duplicate report to the reader, because the deliver skill sends before mark_sent.
    // So derive the same form rescanOwedRuns derives, and the mirror is complete rather than partial.
    const legacy = run.slug && run.codename ? `${run.slug}-${run.codename}` : null;
    const forms = [...new Set([packet.runId, run.runId, args.runId, legacy]
      .filter((id) => id != null && String(id).trim() !== "").map(sanitize))];
    for (const id of forms) {
      try { rmSync(join(config.outboxDir, `${id}.pending`), { force: true }); } catch { /* best-effort */ }
    }
  };
  const sentPath = join(run.runDir, ".sent");
  if (existsSync(sentPath)) {
    clearMarker();
    return { ok: true, runId: run.runId, alreadySent: true, note: "Already marked sent — outbox marker cleared (idempotent)." };
  }
  // SETTLING REQUIRES EVIDENCE (audit item 7, proven on a delivered run): the email was BLOCKED on the
  // send allowlist, yet the courier called mark_sent anyway — .sent was written with messageId:null, and
  // the .sent guard then suppressed every retry, so a metric or reader trusting .sent reported a delivery
  // that did not occur. A settle is a RECEIPT, not an intention: it carries the sent message's id, or an
  // explicit out-of-band attestation (a human-readable sentence saying how the packet actually reached
  // the reader — WhatsApp, a hand-off, a resend from a personal box) recorded VERBATIM in .sent so an
  // auditor reads exactly what the courier claimed. With neither, this refuses — the marker stays, the
  // outbox re-arms, and the send is still owed, which is the truth.
  const messageId = typeof args.messageId === "string" && args.messageId.trim() ? args.messageId.trim() : null;
  const attestation = typeof args.attestation === "string" && args.attestation.trim() ? args.attestation.trim() : null;
  if (!messageId && !attestation)
    throw new Error(`mark_sent: refusing to settle run "${run.runId}" without send evidence — pass messageId `
      + `(the sent email's id) or attestation (an explicit out-of-band statement of how the packet reached the reader, `
      + `recorded verbatim). If the send was blocked or failed, do NOT call mark_sent: leave the marker so the send stays owed.`);
  // `settled` names WHICH packet this receipt is for. A .sent beside a failure packet and a .sent beside a
  // delivery mean two different things to anyone reading the run dir afterwards — "the client was told it
  // failed" is not "the client got their report" — and the file used to be silent about which.
  writeFileSync(sentPath, JSON.stringify({
    ts: new Date().toISOString(), messageId, via: "mcp/mark_sent",
    ...(attestation ? { attestation } : {}),
    settled: packetPath === deliveryPath ? "delivery" : "failure",
  }, null, 2) + "\n");
  // status.json: sendPending -> false (atomic tmp+rename; a torn read must never lose the flip).
  // A failed flip is NON-FATAL (.sent is the primary store and the rollup now derives from it too) but
  // never silent: the note names it, so a courier transcript shows the sidecar disagreeing.
  let statusFlipped = true;
  try {
    const sp = join(run.runDir, "status.json");
    const status = JSON.parse(readFileSync(sp, "utf8"));
    status.sendPending = false;
    writeFileSync(`${sp}.tmp`, JSON.stringify(status, null, 2) + "\n");
    renameSync(`${sp}.tmp`, sp);
  } catch { statusFlipped = false; /* best-effort — .sent is the primary guard */ }
  clearMarker();
  return { ok: true, runId: run.runId, alreadySent: false,
    note: `.sent written${statusFlipped ? ", sendPending cleared" : " (status.json flip FAILED — the rollup settles from .sent)"}, outbox marker removed.` };
}

// feed_context — late-bind the applicant + exclusions onto a run (the B5b binding the pipeline's pre-start
// bind reads from customer-bind.json), and/or attach free-text instructions for the reviewer.
export function feedContext(args = {}) {
  if (!args.runId) throw new Error("feed_context: runId is required");
  const run = resolveRun(String(args.runId));
  if (!run) throw new Error(`feed_context: run "${args.runId}" not found`);
  const wrote = [];
  if (args.customer || (Array.isArray(args.exclusions) && args.exclusions.length)) {
    const bind = {
      customer: args.customer ? String(args.customer) : null,
      exclusions: Array.isArray(args.exclusions) ? args.exclusions.map(String) : [],
      boundAt: new Date().toISOString(), source: "mcp/feed_context",
    };
    writeFileSync(run.P.customerBind, JSON.stringify(bind, null, 2) + "\n");
    wrote.push("customer-bind.json");
  }
  if (args.instructions) {
    const p = driverDir(run.runDir, "fed-context.json");
    ensureDriverDir(run.runDir);
    writeFileSync(p, JSON.stringify({ instructions: String(args.instructions), ts: new Date().toISOString(), source: "mcp/feed_context" }, null, 2) + "\n");
    wrote.push("_driver/fed-context.json");
  }
  if (!wrote.length) throw new Error("feed_context: nothing to write — pass customer, exclusions[], and/or instructions");
  return { ok: true, runId: run.runId, wrote, note: "Late-bind written. Consumed by the pipeline's pre-start applicant bind (customer-bind.json) on the next claim/resume." };
}
