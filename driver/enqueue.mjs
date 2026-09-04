// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// enqueue.mjs — the headless intake CLI (Phase 2 intake contract, path 1 of 2; path 2 is the ops-MCP
// start_run tool, which writes the identical job shape). Validates FIRST, writes ATOMICALLY, and never
// invents a search subject: a job that would park at the runner's intake gate is refused HERE, before it
// ever costs a queue claim (same validateJob + same classify semantics as the runner — one validator,
// two doors).
//
//   node driver/enqueue.mjs --mark NOVAPULSE --classes 9,41 --goods "game software" --forwarder jordan
//   node driver/enqueue.mjs --job request.json          # pre-assembled job JSON (file or "-" for stdin)
//   node driver/enqueue.mjs --job request.json --dry-run  # validate + classify only, write nothing
//
// Queue-dir resolution (first match wins): --queue-dir flag → CLEAROTRON_QUEUE_DIR env → the default agent's
// workspace queue (config.queueDirForAgent). The runner drains all of these (config.queueDirs).
//
// Exit codes (machine-consumable; one JSON result object on stdout, human notes on stderr):
//   0 queued (or --dry-run and the job classifies "run")
//   2 validation refused it (classify "clarify"/"reject" — errors listed; fix the request, don't force it)
//   3 id collision (a job with this id is already queued/processing — re-delivery no-op, mirror start_run)
//   1 anything else (bad flags, unreadable --job file, fs errors)
//
// The CLI serializes proper JSON, so prose fields (brief, goods, instructions…) ride INLINE — the
// prose-sidecar convention (runner.mjs PROSE_PARTS) exists for agents that cannot escape JSON, and
// assembleJob treats a self-contained job identically (the overlay loop is a no-op).

import "../shared/env-local.mjs";   // side effect: apply <repo>/.env when THIS file is the CLI entry (never on library import)
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { config } from "./driver.config.mjs";
import { validateJob, DECLARED_JOB_FIELDS } from "./enqueue-schema.mjs";
import { doorGates } from "./door-gates.mjs";
import { demoRunAgreement } from "./demo-run-agreement.mjs";   // — the WALL's demo decision, consulted not copied
import { envFrom } from "../shared/env-aliases.mjs";   // — read every spelling, not one
import { probeQueueWatch, unwatchedQueueWarning } from "./queue-watch-probe.mjs";   //
import { PRODUCTS } from "./products.mjs";
import { isEntrypoint } from "../shared/is-entrypoint.mjs";   // — one entry-point test, all spellings

// THE OFFERING WRITES ITS OWN MENU. Every figure here — the geography clause, the name count — comes
// off products.mjs, because a hand-typed "up to 20 names" beside a wall that refuses at 8 is exactly
// what this build removed from the composer's own template row.
const PRODUCT_MENU = PRODUCTS.map((p) =>
  `                               ${p.id.padEnd(28)} ${p.geography}; up to ${p.maxNames} name${p.maxNames === 1 ? "" : "s"}${p.caseLaw ? "; carries the case law" : ""}`,
).join("\n");

const USAGE = `usage: node enqueue.mjs [--job <file.json>|-] [field flags] [--queue-dir <dir>] [--dry-run]
  field flags (compose a job without a file; a flag OVERRIDES the same field from --job):
    --mark <name>            the mark to clear (required unless --job supplies it)
    --marks <text>           a BATCH, one name per line, optional "[9, 42]" classes per line. A
                             knockout search screens up to 8 in one job
    --classes <9,41>         Nice classes (classes OR --goods — either suffices)
    --goods <text>           goods/services description
    --jurisdictions <US,EU>  territories to search (optional — omit for the account's defaults).
                             Present ⇒ AUTHORITATIVE: the frame is told not to widen past them.
                             They also decide WHICH clearance this is: one country is a Full country
                             search, two or more (or a region) a Multi-country focus search
    --worldwide              search everywhere, and refuse to be narrowed by the account's own
                             territories. NOT the same as omitting --jurisdictions, which means
                             "whatever the account says"
    --platforms <a.com,b.com> extra marketplaces to sweep, ADDED to the account's own (never a
                             replacement — a client's platform list is a mandate)
    --ref <TMP-1234>         matter reference (optional — a refless job runs under a noref slug)
    --customer <name>        applicant/owner (optional — omitting arms the late-bind watch)
    --profile <key>          customer profile key (optional — omit for the generic profile)
    --forwarder <id>         REQUIRED: requester/reply-routing key — rides the delivery packet so the
                             integrator knows who gets the report (no default; a wrong route misdelivers)
    --forwarder-email <a@b>  requester email for the delivery packet
    --instructions <text>    upfront instructions (verbatim into the run)
    --brief-file <path>      read the confirmation brief from a file (inline into the job)
    --raw-request-file <p>   read the verbatim original request from a file
    --deadline <ISO8601>     optional deadline (drives the deadline-envelope arithmetic)
    --product <id>           which of the four searches to run (omit for the account's default, or
                             for the one this request's territories name):
${PRODUCT_MENU}
    --native-language        the native-language investigation. Offered on a multi-country focus
                             search only — it is AUTOMATIC on a full country search and not part of
                             the other two
    --delivery-route <lane>  how the finished packet leaves: "email" (the default) or "portal".
                             "portal" is REFUSED at every door until the portal delivery lane ships —
                             a portal request must never silently go out by email
    --recipe-key <slug>      a saved search — mutually exclusive with --product
    --id <id>                job id (default cli-<ts>-<rand>; the queue's dedup key)
    --agent <id>             workspace agent whose queue to use when no --queue-dir/CLEAROTRON_QUEUE_DIR
    --dup-override           force-run past the matter-dedup gate (requester-confirmed re-run only)
`;

function fail(msg, code = 1) {
  process.stderr.write(`enqueue: ${msg}\n`);
  process.exit(code);
}

export function parseArgs(argv) {
  const o = { flags: {} };
  const val = { "--job": "job", "--mark": "mark", "--classes": "classes", "--goods": "goods",
    "--ref": "ref", "--customer": "customer", "--profile": "profile", "--forwarder": "forwarder",
    "--forwarder-email": "forwarderEmail", "--instructions": "instructions", "--brief-file": "briefFile",
    "--raw-request-file": "rawRequestFile", "--deadline": "deadline", "--id": "id", "--agent": "agent",
    "--marks": "marks",
    // per-run scope + the selectors. product/recipeKey are flags here AND read by assembleFromFlags:
    // a field read but never wired to a flag is a field only --job can reach, which is how --marks died.
    "--jurisdictions": "jurisdictions", "--platforms": "platforms",
    "--product": "product", "--recipe-key": "recipeKey",
    // The delivery lane. WIRED TO A FLAG, not only readable from --job, and that is the convention above being
    // obeyed rather than quoted: assembleFromFlags reads `flags.deliveryRoute` (the dev cockpit sets it),
    // and a field read but reachable from no flag is a field only --job can name — which is how --marks
    // died. "portal" is refused by name at every door until the lane ships; "email" is today's default.
    "--delivery-route": "deliveryRoute",
    "--queue-dir": "queueDir" };
  const bool = { "--dry-run": "dryRun", "--dup-override": "dupOverride", "--help": "help", "-h": "help",
    // Two BOOLEAN flags where the job field is not a boolean the CLI can pass through: --worldwide is
    // the geography MODE (an absent --jurisdictions means "the account's", which is a different search),
    // and --native-language is the offering's one toggle. Both are flags rather than values because a
    // `--worldwide false` that read as truthy is exactly the shape this build is removing.
    "--worldwide": "worldwide", "--native-language": "nativeLanguage" };
  for (let i = 0; i < argv.length; i++) {
    if (bool[argv[i]]) { o.flags[bool[argv[i]]] = true; continue; }
    const key = val[argv[i]];
    if (!key) throw new Error(`unknown flag ${argv[i]}`);
    const v = argv[++i];
    if (v === undefined) throw new Error(`${argv[i - 1]} needs a value`);
    o.flags[key] = v;
  }
  return o.flags;
}

/**
 * THE CLI'S HALF OF THE DECLARED-FIELD PARTITION (enqueue-schema.mjs DECLARED_JOB_FIELDS).
 *
 * This door is the one that CANNOT drop, and that is a property of its shape rather than of anyone's
 * diligence: `--job` (or stdin) is parsed as the job itself and the flags are overlaid ON TOP, so every
 * declared field a caller writes survives to validateJob whether or not a flag exists for it. There is no
 * allow-list here to leave a field out of.
 *
 * Declared anyway, and asserted by doors-agree.test.mjs alongside the other three, because "this door
 * carries everything" is a claim that stops being true the first time somebody adds a field filter — and
 * an unstated claim is one nobody re-checks.
 */
export const CLI_JOB_FIELDS = Object.freeze({
  carries: DECLARED_JOB_FIELDS,
  notCarried: Object.freeze({}),
});

// Assemble the job object: --job file (or stdin) as the base, field flags overlaid on top. Same shape +
// same defaults as ops.mjs startRun so the two intake doors are indistinguishable to the runner.
export function assembleFromFlags(flags, readFile = (p) => readFileSync(p, "utf8")) {
  let job = {};
  if (flags.job) {
    const raw = flags.job === "-" ? readFileSync(0, "utf8") : readFile(flags.job);
    job = JSON.parse(raw); // a malformed file is the caller's bug — surface it, never enqueue it
    if (!job || typeof job !== "object" || Array.isArray(job)) throw new Error("--job must contain one JSON object");
  }
  const classes = flags.classes
    ? String(flags.classes).split(/[\s,]+/).map(Number).filter(Number.isFinite)
    : undefined;
  // Per-run scope. Split on commas/whitespace like --classes; validateJob owns the vocabulary from
  // here (shape, caps, dedupe, and every rule the offering states), so this door cannot drift from
  // start_run or the portal.
  // COMMAS ONLY, and that is a fix rather than a style choice: the shared splitter used /[\s,]+/, so
  // `--jurisdictions "United States,France"` arrived as four entries — "United", "States", "France" —
  // and every one of the first two was refused as a territory nobody recognizes. A territory name has
  // spaces in it; a class number and a store domain do not, which is why only this splitter changes.
  const listFlag = (v) => (v == null ? undefined : String(v).split(",").map((x) => x.trim()).filter(Boolean));
  const jurisdictions = listFlag(flags.jurisdictions);
  const platforms = listFlag(flags.platforms);
  // The selectors + a multi-mark batch. `marks` accepts an array of {name, classes?, ref?} (or bare name
  // strings / one-per-line text) — a knockout batch is ONE job carrying every mark; markName defaults to
  // the first for slug/display continuity.
  //
  // `--marks` HAS A FLAG NOW. `flags.marks` was read here and appeared in neither flag map, so every
  // invocation of it died on "unknown flag --marks" and the batch form was unreachable from this door —
  // the same defect the comment above records as already fixed once for the selectors.
  const marksIn = Array.isArray(flags.marks)
    ? flags.marks
    : typeof flags.marks === "string"
      ? flags.marks.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((l) => {
          // "NAME [9, 42]" — optional per-mark classes in brackets
          const m = l.match(/^(.*?)\s*\[([\d,\s]+)\]\s*$/);
          return m ? { name: m[1].trim(), classes: m[2].split(/[\s,]+/).map(Number).filter(Number.isFinite) } : { name: l };
        })
      : undefined;
  const marks = Array.isArray(marksIn)
    ? marksIn.map((m) => (typeof m === "string" ? { name: m } : m)).filter((m) => m?.name && String(m.name).trim())
    : undefined;
  const overlay = {
    id: flags.id, ref: flags.ref, markName: flags.mark ?? (marks?.length ? String(marks[0].name) : undefined), classes,
    goods: flags.goods, customer: flags.customer, profileKey: flags.profile,
    forwarder: flags.forwarder, forwarderEmail: flags.forwarderEmail,
    upfrontInstructions: flags.instructions, deadline: flags.deadline,
    jurisdictions: jurisdictions?.length ? jurisdictions : undefined,
    platforms: platforms?.length ? platforms : undefined,
    // THE GEOGRAPHY STAMP, stated rather than inferred. `--worldwide` is a positive instruction that
    // outranks the account's own territories; its absence is silence, and silence resolves down the
    // ladder. validateJob refuses the contradiction (worldwide alongside named territories) rather than
    // picking a side.
    geography: flags.worldwide ? { mode: "worldwide", origin: "request" } : undefined,
    product: flags.product, recipeKey: flags.recipeKey,
    // The delivery lane, carried verbatim for validateJob and the door gates to rule on. This assembler
    // serves TWO doors — the CLI and the dev cockpit (dev-portal.mjs builds this same flags object) —
    // and the cockpit had no way to name the field at all, so a `deliveryRoute: "portal"` posted there
    // vanished before any gate saw it and the run went out by email. One overlay entry closes both.
    deliveryRoute: flags.deliveryRoute,
    // The offering's one toggle. `--native-language` is a BOOLEAN flag and can only ever say true; an
    // explicit `false` reaches this assembler through --job (the CLI) or the body (the cockpit) and is
    // carried by the base rather than overwritten here — validateJob refuses it, in products.mjs's words.
    nativeLanguage: flags.nativeLanguage ? true : undefined,
    marks: marks?.length ? marks : undefined,
    brief: flags.briefFile ? readFile(flags.briefFile) : undefined,
    rawRequest: flags.rawRequestFile ? readFile(flags.rawRequestFile) : undefined,
    dupOverride: flags.dupOverride ? true : undefined,
  };
  for (const [k, v] of Object.entries(overlay)) if (v !== undefined) job[k] = v;
  // Same auto-defaults as start_run: id is the queue's dedup key; msgId threads the eventual delivery
  // packet back to the request (inReplyTo); conversationId feeds the thread dimension of matter-dedup.
  job.id ??= `cli-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
  job.msgId ??= `<${job.id}@enqueue.local>`;
  job.conversationId ??= job.id;
  if (job.markName && !Array.isArray(job.marks)) {
    const m = { name: String(job.markName) };
    if (job.ref) m.ref = job.ref;
    if (Array.isArray(job.classes) && job.classes.length) m.classes = job.classes;
    job.marks = [m];
  }
  job.enqueuedAt ??= new Date().toISOString();
  job.enqueuedVia ??= "cli/enqueue";
  return job;
}

export function resolveQueueDir(flags, env = process.env) {
  if (flags.queueDir) return flags.queueDir;
  // — ACROSS SPELLINGS, and this one is product code rather than a harness path: an operator who
  // set only `CLEAROTRON_QUEUE_DIR` had their queue resolve to the default agent's workspace, with
  // nothing said. `env` is a parameter here, so the read cannot rely on a translation having run in
  // this process — that is exactly the case `envFrom` exists for.
  const fromEnv = envFrom(env, "CLEAROTRON_QUEUE_DIR");
  if (fromEnv) return fromEnv;
  return config.queueDirForAgent(flags.agent || config.defaultAgent);
}

async function main(argv) {
  let flags;
  try { flags = parseArgs(argv); } catch (e) { process.stderr.write(USAGE); fail(e.message); }
  if (flags.help) { process.stdout.write(USAGE); return; }
  let job;
  try { job = assembleFromFlags(flags); } catch (e) { fail(`could not assemble the job: ${e.message}`); }
  if (!job.forwarder) fail("missing --forwarder — the requester/reply-routing key; the delivery packet needs it to route the report (there is deliberately no default)", 2);
  // THE EARLY --product CHECK IS GONE, and its deletion is the fix. It fired before validateJob and said
  // the same thing in different words — `--product "prelim"` rather than `product "prelim"`, and without
  // the `(or omit it for the account's default)` clause, which is the one clause that tells a requester
  // the field is optional. So the CLI's real answer to a typo was not the shared one, and a test that
  // started at assembleFromFlags could never see it. validateJob refuses it now, in the sentence every
  // door quotes (products.mjs unknownProductMessage). See the commit body for the rejected alternative.

  const v = validateJob(job);
  const result = { ok: v.ok, id: job.id, classify: v.classify, errors: v.errors, warnings: v.warnings };
  if (!v.ok) {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    fail(`refused (${v.classify}): ${v.errors.join("; ")}`, 2);
  }
  // THE RESOLVED PRODUCT'S OWN CHECKS, at this door too. validateJob can only judge what the REQUEST
  // states; the product an account default or the request's own territories names is only knowable once
  // the profile and the saved-search store are read. Without this the CLI queued requests the runner
  // refused hours later at claim — the asymmetry exists to end. Fails OPEN exactly as the portal's
  // plan gate does: an unreadable config store must not stop a search, and the runner is still the wall.
  const gates = doorGates(job);
  if (gates.errors.length) {
    const gated = { ok: false, id: job.id, classify: "clarify", errors: gates.errors, warnings: [...v.warnings, ...gates.warnings] };
    process.stdout.write(JSON.stringify(gated, null, 2) + "\n");
    fail(`refused (clarify): ${gates.errors.join("; ")}`, 2);
  }
  for (const w of [...v.warnings, ...gates.warnings]) process.stderr.write(`enqueue: note — ${w}\n`);

  const qdir = resolveQueueDir(flags);
  const dest = join(qdir, `${job.id}.json`);
  if (flags.dryRun) {
      // ── WHAT THE WALL WOULD DECIDE, REPORTED BY THE DRY RUN ────────────────────
    //
    // `--dry-run` answered a narrower question than the one it is used for: "is this well-formed enough to
    // enqueue?" rather than "will this run?". It reported `ok:true, classify:"run"` on jobs `claimAndPrep`
    // then rejected outright, and two demo clearances were enqueued on that answer.
    //
    // FOUR OF THE WALL'S FIVE DECISIONS WERE ALREADY ABOVE, inside `doorGates`: a clarified resolution, the
    // portal route, the policy gate and the resolved-product rules. The demo agreement was the only one
    // nothing at this door asked.
    //
    // CONSULTED, NOT DUPLICATED — the same exported predicate `claimAndPrep` calls, so the two cannot
    // drift. The WALL STAYS WHERE IT IS: it is the chokepoint every path reaches and the doors are
    // fail-open by their own doctrine. This says it EARLIER, never instead.
    //
    // NOT INSIDE `gateResolvedRequest`, and that placement was built and then rejected ON EVIDENCE. That
    // function is the RESOLVED-PRODUCT gate and 42 arms depend on its contract: it answers "is this product
    // and scope orderable", which is a question about the REQUEST. Whether an account is fiction is a
    // question about the ACCOUNT. Folding the second into the first made a two-name budget refusal come
    // back as a demo refusal, because every shipped profile but `generic` carries `demoData: true`. Two
    // questions, two places.
    //
    // AFTER the product gate, matching the wall's own precedence: there `!policy.clarify` guards the demo
    // check, so an unresolvable request clarifies and the demo question is never reached. Asking it first
    // would reject where the wall clarifies — the same two-surfaces-disagree defect, pointing the other way.
    const profileKnown = gates.profile != null && gates.readable !== false;
    const admission = profileKnown ? demoRunAgreement({
      demoRun: job?.demoRun === true,
      demoData: gates.profile?.demoData === true,
      who: job?.account ?? job?.profileKey ?? "this account",
    }) : null;
    if (admission && !admission.ok) {
      // REJECT, NOT CLARIFY, in the wall's own words. Clarify means "re-send and it can proceed", and
      // neither side of this mismatch is something a re-send can fix.
      // THE JOB RIDES THE REFUSAL TOO, for the same reason the dry run prints it on the happy path: an
      // answer of only "no" cannot be used to check WHAT was refused. An operator needs both halves —
      // what would have been stored, and why it will not run — and a door that drops the request on
      // refusal makes them unreadable together.
      const refused = { ok: false, id: job.id, classify: "reject", errors: [admission.reject],
        warnings: [...v.warnings, ...gates.warnings], wouldWrite: dest, job };
      process.stdout.write(JSON.stringify(refused, null, 2) + "\n");
      fail(`refused (reject): ${admission.reject}`, 2);
    }
    // AN ABSENCE IS A FINDING, and this is the criterion that fights the door's own doctrine. Doors fail
    // OPEN — an unreadable profile store must not stop somebody starting a search — but `demoData` lives on
    // the profile, so failing open here means reporting a pass on a question this vantage could not ask.
    // A could-not-check is not a check, and it is not a refusal either. Two states where the truth has
    // three is how a dry run comes to promise more than it verified.
    const couldNotCheck = profileKnown ? [] : ["whether this account is demo data: the profile did not "
      + "resolve, so `demoData` is unreadable from this door. The runner's wall still decides it, and it "
      + "rejects a demo profile whose job does not declare `demoRun`."];
    for (const c of couldNotCheck) process.stderr.write(`enqueue: COULD NOT CHECK — ${c}\n`);

    // THE JOB ITSELF, not only the path. A dry run whose answer is "it would go here" cannot be used to
    // check WHAT would go there — which is the one question a dry run is asked. It is also what lets the
    // parity test compare the request this door stores against the other doors' without a queue write.
    process.stdout.write(JSON.stringify({ ...result, dryRun: true, wouldWrite: dest, job,
      // WHAT COULD NOT BE CHECKED RIDES THE ANSWER: a dry run read as "this will run" must carry the
      // question it could not ask in the same object as the verdict, not only in a log (issue 2040).
      ...(couldNotCheck.length ? { couldNotCheck } : {}) }, null, 2) + "\n");
    return;
  }
  mkdirSync(qdir, { recursive: true });
  // Collision = the id is already queued or claimed. Job ids are dedup keys (a re-delivered request
  // re-uses its id); refusing here mirrors start_run and keeps a double-submit from racing the claim.
  if (existsSync(dest) || existsSync(join(qdir, `${job.id}.processing`)))
    fail(`a job with id "${job.id}" is already queued/processing in ${qdir}`, 3);
  const tmp = `${dest}.tmp`;
  writeFileSync(tmp, JSON.stringify(job, null, 2) + "\n");
  renameSync(tmp, dest); // atomic publish — the runner claims *.json, never a half-written file
  // — AFTER the publish, never before it. The job is accepted either way: this asks whether
  // anything will WAKE for it, and a check that could refuse a well-formed job because a systemd unit
  // is missing would be a worse failure than the one it guards. Silent unless a unit exists and does
  // not cover this directory.
  const watch = probeQueueWatch({ queueDirs: [qdir] });
  process.stdout.write(JSON.stringify({ ...result, queued: true, queuePath: dest, queueWatched: watch.state }, null, 2) + "\n");
  if (watch.state === "fail") process.stderr.write(unwatchedQueueWarning(qdir, watch.unitPath) + "\n");
  process.stderr.write(`enqueue: queued ${job.id} → ${dest}\n` +
    `enqueue: the runner assigns the runId/codename on claim; watch the queue markers (.processing → .done/.failed) or the MCP list_runs.\n`);
}

if (isEntrypoint(import.meta.url)) {
  await main(process.argv.slice(2));
}
