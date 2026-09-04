// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// Job-file shape for studio/prelim-search/queue/<id>.json (written by email-loop on a prelim-search request).
// The job id = sanitized email message-id so a re-delivered webhook overwrites the same file (no duplicate run).
//
// Blocking semantics follow change-spec v3 §B2: the ONLY content reason a search may not start is the
// search subject being genuinely unresolvable — no mark name, or neither classes nor a goods description
// (either one suffices; the intake gate infers the missing side pre-queue per §B3.4). A missing reference
// number NEVER blocks (a live slogan-mark silent-reject, 2026-06-10) — a refless job runs
// with a `noref<hash>` slug (see phase0.mjs deriveSlug). The intake confirmation brief (email-loop §6)
// resolves ambiguity BEFORE enqueue; this validator is the runner-side mechanical backstop.

import { loadProfiles, loadProjects, resolveProfile, applicantMatchesProfile, recipeProseGuard, platformEntryErrors } from "./profiles.mjs";
import { demoRunShape } from "./demo-run-agreement.mjs";
import { ORDERABLE_PRODUCTS, policyFor, checkMarkBudget, checkScopeAgainstPolicy, loadRecipes, kebabCollisions, resolveSearchPolicy } from "./search-policy.mjs";
// — the §B2 gate resolves the subject through the SAME ladder the run uses. See the gate itself.
import { resolveEffectiveProfile } from "./profiles.mjs";
import { resolveEffectiveScope } from "./effective-scope.mjs";
import { PLAN_MAX_NAME_LENGTH } from "./register-plan.mjs";   // — the product's existing answer, applied at the door
// THE OFFERING — what each product accepts, and the exact sentence a door refuses with when a request
// does not. Every one of these is written ONCE, in products.mjs, and quoted by the portal, start_run,
// the CLI and the runner alike: a refusal that varies by door is the defect exists to end.
import { productName, productSpec, checkProductScope, checkNativeLanguage, unknownProductMessage, CASE_LAW_NOT_A_REQUEST, NATIVE_LANGUAGE_NOT_A_SUPPRESSION, SEARCH_LEVEL_NOT_A_REQUEST } from "./products.mjs";
// What kind of place each entry names — worldwide token, region, country, or nothing we recognize
// (territory-tiers.mjs: pure data + pure functions, no env, no fs). It answers BOTH questions this
// door used to answer by hand: which entries are the worldwide tokens, and how many of the rest are
// actually countries.
import { partitionTerritories } from "./territory-tiers.mjs";
// — the sidecar field map, from the module that OWNS it. The check below asks whether the prose a
// manifest declared actually arrived, and a local copy of that list is how the two would drift apart.
import { PROSE_PARTS } from "./queue-markers.mjs";

// ── per-run scope limits ──────────────────────────────────────────────────────────────────────────────
// Caps, not policy. They exist so one malformed request cannot mint an unbounded search: every extra
// territory is another register plan and another set of lanes, and every extra platform raises the
// common-law grid floor for EVERY variant (derivedFloor/derivedBatchSize in profiles.mjs). A client who
// genuinely needs more states it in their profile, where a human sees the number.
//
// MAX_JURISDICTIONS is EXPORTED only so doc-constants.mjs can bind the shipping docs that restate it
// to this declaration. Nothing in the driver reads it from outside this file, and nothing
// should: the cap is enforced here, at the door, and a second reader would be a second opinion.
export const MAX_JURISDICTIONS = 20;
const MAX_RUN_PLATFORMS = 10;

// ── the geography stamp's vocabulary ──────────────────────────────────────────────────────────────────
// Exported so a door states a mode rather than spelling one, and so the enum has ONE list. The full
// reasoning sits beside the stamp itself, in validateJob.
export const GEOGRAPHY_MODES = Object.freeze(["worldwide", "named", "account-default"]);
// Which layer supplied the territories in the stored job. "request" and "account-default" are the only
// two a door can honestly stamp; the other two are for a writer that freezes a resolved layer into the
// job, which nothing does yet.
export const GEOGRAPHY_ORIGINS = Object.freeze(["request", "saved-search", "project", "account-default"]);
// Nice classification: 1–34 goods, 35–45 services. The range has been fixed since 2002 and is not ours
// to widen.
const NICE_MIN = 1;
const NICE_MAX = 45;

// ── the delivery lane that is DECLARED but not BUILT ────────────────────────────────────────────────
//
// deliveryRoute:"portal" validates shape-wise (it is a real value of a real field) and has NO consumer
// yet — the courier would email it anyway — so admission CLARIFIES on it rather than accepting it as a
// silent no-op. The sentence lives HERE, beside the shape check that lets the value through, because two
// doors now have to say it: the runner at admission (THE WALL) and plan_run in the free preview.
//
// One string, not two. plan_run's whole contract is that it describes the job start_run would build, and
// a preview reporting wouldRun:true about a request admission is going to refuse is the dishonesty the
// preview exists to remove — the invitation/enforcement mismatch, on a field the MCP schemas OFFER by
// name. Whatever offers an option has to agree with whatever enforces it, in the same words.
export const PORTAL_ROUTE_UNAVAILABLE = `deliveryRoute "portal" is not available in this build yet — the portal delivery lane ships with the portal; omit deliveryRoute to deliver by email`;

/** True when this job asks for that unbuilt lane. Trim + case-fold, exactly as the shape check reads it. */
export function wantsPortalRoute(job) {
  return String(job?.deliveryRoute ?? "").trim().toLowerCase() === "portal";
}

// ── EVERY FIELD A JOB MAY CARRY ─────────────────────────────────────────────────────────────────────
//
// WHY THIS LIST EXISTS, AND WHAT IT IS FOR.
//
// Every door builds its job from a foreign body — an HTTP POST, an MCP argument bag, a form — by naming
// the fields it copies across. That is an ALLOW-LIST, and an allow-list has one failure mode: a field
// the requester states and the assembler does not name is GONE before `validateJob` or any door gate can
// rule on it. Not refused. Not warned about. Gone, with a 200 on the way out.
//
// That is exactly how `deliveryRoute: "portal"` — a DECLARED field, with its own refusal sentence
// (PORTAL_ROUTE_UNAVAILABLE) written twelve lines above this one — was refused by name at start_run, the
// CLI, plan_run and the runner's wall while the portal and the dev cockpit returned 200 on /plan, 200 on
// /run, and delivered the run BY EMAIL. The guarantee: a portal request must never silently go out by email.
//
// So this is the CLOSED SET the doors are measured against. Each assembling door declares which of these
// it CARRIES and which it deliberately does not (with a reason), and `driver/test/doors-agree.test.mjs`
// asserts the two together are exactly this list. A field added here without being classified at every
// door FAILS THE SUITE on the commit that adds it — which is the only moment at which classifying it is
// cheap, and the only mechanism that catches the field nobody remembered.
//
// TEST-TIME, NOT RUNTIME, AND THAT IS THE CHOICE. See the commit body: the doors' WIRE vocabularies
// legitimately differ (the dev cockpit posts `mark`, the CLI takes `--worldwide` where the job carries
// `geography`), so a runtime "refuse any declared field this door does not carry" would answer three of
// five doors with a sentence naming the wrong remedy. The mechanism is what had to change, and the
// mechanism is a total partition somebody has to keep total.
export const DECLARED_JOB_FIELDS = Object.freeze([
  // identity + reply routing
  "id", "msgId", "conversationId", "forwarder", "forwarderEmail", "forwarderDomain",
  // the search subject
  "markName", "name", "marks", "classes", "goods", "use", "ref", "tmp",
  // per-run SCOPE — where the machinery points
  "jurisdictions", "platforms", "geography",
  // the selectors + the offering's toggles — WHICH machinery runs
  // `searchLevel` is DECLARED so that every door must classify it, and CARRIED so that validateJob can
  // refuse it by name. A field a door merely omits from its allow-list is a field the requester is never
  // told about — the retired selector was silently dropped at the portal and the run went out at
  // whatever product the scope implied. Same treatment as `caseLaw` one entry along.
  "product", "recipeKey", "nativeLanguage", "caseLaw", "searchLevel",
  // delivery + lineage
  "deliveryRoute", "parentRunId",
  // whose rulebook rates it
  "profileKey", "projectKey", "customer", "customerUnknown",
  // intake fidelity — posture and prose, verbatim from the request
  "deliverableSpec", "commercialFlexibility", "priorUse", "campaignShape",
  "upfrontInstructions", "brief", "rawRequest", "deadline", "provider",
  // admission stamps a door may set
  "dupOverride", "clientPrincipal", "enqueuedAt", "enqueuedVia", "enqueuedBy",
  // — THE REQUESTER'S DECLARATION OF WHICH INTAKE SHAPE IT EMITTED, and it is not a toggle this
  // code acts on. `promptParts: true` says "the prose rides as SIDECAR files (<base>.brief.md, …), not
  // inline in this manifest" — the shape that exists because the hand-emitting email-loop agent can only
  // `write` files, and an unescaped quote inside inline `brief` prose once made JSON.parse throw at
  // intake and parked a job with nothing searched (runner.promptparts.test.mjs's own header).
  //
  // Nothing READS it, and that is not the same as it meaning nothing: `assembleJob` detects the sidecars
  // structurally (existsSync per PROSE_PARTS entry), so the declaration went redundant the moment the
  // overlay became presence-driven. Declared here so the doors can rule on it and the check below can
  // hold the requester to what it declared — see it for the defect that earns this entry.
  "promptParts",
  // — THE REQUESTER'S CONSENT that this run is a demo, and it is only ever consent.
  // The profile's `demoData` decides whether an account is fiction and stays non-overlayable; this field
  // says the requester knows. Declared so every door must classify it and validateJob can refuse it by
  // name — a field a door merely omits is one the requester is never told about.
  "demoRun",
  // — WHERE A FIXTURE RUN SAYS SO, on the run's own record rather than in a shell.
  //
  // The counts and records lanes each had an environment variable that made shipped code stop calling
  // the register and read canned payloads instead. Ambient state deciding whether a result came from a
  // real register is the hazard the demo marker closes one level up: a fixture result wearing real
  // clothes, with nothing on the artifact to say otherwise. Declared on the job, the fact travels WITH
  // the run — the same reasoning as engineCommit and demoData.
  //
  // `{ counts?: "<dir>", records?: "<dir>" }`. Absent ⇒ the provider is called, which is the only
  // behaviour a production job has ever had.
  "registerFixtures",
]);

// — WHAT A JOB CARRIES THAT NOBODY DECLARED, said out loud instead of dropped in silence.
//
// The header above describes the allow-list's one failure mode: a field the requester states and the
// assembler does not name is "GONE before validateJob or any door gate can rule on it. Not refused. Not
// warned about. Gone, with a 200 on the way out." That is written down as the reason DECLARED_JOB_FIELDS
// exists — and the mechanism it bought is a TEST-TIME partition, which catches a field WE add and cannot
// see a field somebody ELSE writes.
//
// is that blind spot arriving: `promptParts` is in production job manifests and appears nowhere in
// this repo's code — one test fixture, consumed by nothing. It reached a queue file, so it did not come
// through an assembling door at all; a hand-written `<id>.json` is a documented intake route (INTAKE.md)
// and it bypasses every allow-list there is. Nothing anywhere said so.
//
// THIS DOES NOT REFUSE, DELIBERATELY. The writer is unidentified and live, and a hard refusal would
// start breaking something nobody has found yet, loudly, in production. A warning names the field where
// it is seen — at the door, and again at the runner's wall where a directly-written queue file passes —
// so the census that identifies the writer comes off the records rather than off a guess. Refusal is the
// follow-up once that census is real, and it is stated on rather than smuggled in here.
export function undeclaredJobFields(job) {
  if (!job || typeof job !== "object" || Array.isArray(job)) return [];
  const declared = new Set(DECLARED_JOB_FIELDS);
  // `_`-prefixed keys are the convention for a writer's own bookkeeping and are not job vocabulary;
  // flagging them would make this noisy about the one thing it is not for.
  return Object.keys(job).filter((k) => !declared.has(k) && !k.startsWith("_")).sort();
}

/** The sentence every surface uses for it — one wording, so the door and the wall cannot drift. */
export function undeclaredFieldsWarning(names) {
  const list = names.map((n) => JSON.stringify(n)).join(", ");
  return `job carries ${names.length} field(s) no door declares: ${list} — DECLARED_JOB_FIELDS does not `
    + `name them, so nothing validates them, no door gate can rule on them, and any assembling door `
    + `drops them silently. Declare them in driver/enqueue-schema.mjs if they are meaningful, or stop `
    + `writing them. #1085`;
}

// — "DID THE REQUEST NAME ANY CLASSES?", ONCE.
//
// This predicate had three copies: the door's (§B2 below), the clearance framing prompt's, and the
// knockout framing prompt's — and the knockout one read TOP-LEVEL ONLY. A knockout is a batch keyed on
// `job.marks`, so per-mark classes is its natural shape and that is exactly the shape it missed. The
// clearance builder's own comment already said what the rule is: "'the request names none' must mirror
// the intake's classes-anywhere predicate (enqueue-schema: top-level classes OR any marks[].classes)".
//
// The cost was two wrongs in one line, and the door could catch neither — §B2 admits such a request
// without comment, because `marks[].classes` IS classes:
//
//   1. the parenthetical is FALSE. The request named class 25; the framing model was told it named none.
//   2. it offers the WRONG classes — the customer's defaults, from a layer the requester did not choose
//      for this run, to a model framing a search for a class they did.
//
// It fails the usual way: nothing throws, the run completes, and the framing is merely aimed at the
// wrong goods. The knockout's wording is "consider them" where the clearance lane says "apply these",
// which is softer — and softer is why it would survive a reading and not a run.
//
// So the door owns the vocabulary and the framing builders read it. `driver/stages.mjs` still carries
// its own correct copy (that file belongs to another lane's active work); the three are pinned against
// each other in driver/test/knockout-classes-predicate.test.mjs, so a copy that drifts is a red suite
// rather than a prompt aimed at the wrong goods.
export function requestNamesClasses(job) {
  const j = job ?? {};
  if (Array.isArray(j.classes) && j.classes.length) return true;
  return Array.isArray(j.marks) && j.marks.some((m) => Array.isArray(m?.classes) && m.classes.length);
}

// Nice classes as DATA — used for job.classes and for each marks[] entry, so a batch cannot smuggle
// through a class the top-level check would have caught.
function niceClassErrors(list, label) {
  const bad = (list ?? []).filter((c) => !Number.isInteger(c) || c < NICE_MIN || c > NICE_MAX);
  if (!bad.length) return [];
  return [`${label} ${bad.map((c) => JSON.stringify(c)).join(", ")} — Nice classes are whole numbers ${NICE_MIN}–${NICE_MAX} (1–34 goods, 35–45 services); correct or drop them`];
}

// Returns { ok, errors, warnings, classify }:
//   classify "run"     — ok:true; warnings[] may note proceed-with-default choices (e.g. no ref)
//            "clarify" — runnable identity exists but the SEARCH SUBJECT is unresolvable (no mark, or
//                        no classes AND no goods anywhere): the fix is a question back to the requester
//            "reject"  — can't run or can't even reply: not an object / missing id (dedup lock + marker
//                        filename) / missing msgId (delivery notify hard-requires inReplyTo) / missing
//                        forwarder (selects clawdi_send_<forwarder> — no reply path without it)
// ── · WHAT A MARK NAME MAY CONTAIN ────────────────────────────────────────────────────────────
//
// Intake stored the mark verbatim. Three consequences, driven at the CLI door on 9bd4f8b, all accepted
// with rc=0:
//
//   U+202E in a name survives `esc()` — which escapes & < > " and is not meant to touch bidi controls —
//   and reaches the report body, where it REVERSES THE DISPLAY of everything after it. The report is a
//   legal deliverable that goes to a client.
//
//   A zero-width joiner makes "AUR\u200DORA" render as AURORA and compare unequal to it, so
//   `selfExclusionOwners` and dedup both miss a mark a human reads as the account's own.
//
//   NFD "SIRÈNE" !== NFC "SIRÈNE", so one mark submitted two ways is two matters, two searches, two bills.
//
// REFUSED, NOT STRIPPED, for the display-control classes. Silently altering the mark a client asked
// about is its own defect and a worse one: the deliverable would then name a mark nobody ordered. NFC is
// the exception because it changes no character a reader can see — it is the same string, spelled once.
//
// WHAT THIS DELIBERATELY DOES NOT TOUCH, because an over-broad filter here is worse than the defect:
//   • ACCENTED AND NON-LATIN LETTERS. SIRÈNE, СOLA and an Arabic or Hebrew mark are all legitimate things
//     to clear. The refusal is for explicit direction-OVERRIDE controls, never for letters that happen to
//     be right-to-left — an Arabic mark contains no U+202x at all.
//   • HOMOGLYPHS. A Cyrillic ES in СOLA is measured in  and explicitly NOT claimed as a defect;
//     refusing it would reject a mark somebody legitimately wants cleared.
//   • FREE PROSE (`goods`, `upfrontInstructions`). Those can legitimately carry mixed-direction text, and
//     a bidi control in an Arabic goods description is doing its job. That surface is unchecked and
//     stated so rather than left implied.
const MARK_DISPLAY_CONTROLS = new Map([
  [0x202a, "LEFT-TO-RIGHT EMBEDDING"], [0x202b, "RIGHT-TO-LEFT EMBEDDING"],
  [0x202c, "POP DIRECTIONAL FORMATTING"], [0x202d, "LEFT-TO-RIGHT OVERRIDE"],
  [0x202e, "RIGHT-TO-LEFT OVERRIDE"],
  [0x2066, "LEFT-TO-RIGHT ISOLATE"], [0x2067, "RIGHT-TO-LEFT ISOLATE"],
  [0x2068, "FIRST STRONG ISOLATE"], [0x2069, "POP DIRECTIONAL ISOLATE"],
  [0x200b, "ZERO WIDTH SPACE"], [0x200c, "ZERO WIDTH NON-JOINER"], [0x200d, "ZERO WIDTH JOINER"],
  [0xfeff, "ZERO WIDTH NO-BREAK SPACE"],
]);

/** Every offending codepoint in `value`, with its 1-based character position. */
export function markDisplayControlsIn(value) {
  const hits = [];
  const chars = [...String(value ?? "")];   // by CODEPOINT: a surrogate pair is one character to a reader
  chars.forEach((ch, i) => {
    const cp = ch.codePointAt(0);
    if (MARK_DISPLAY_CONTROLS.has(cp)) hits.push({ cp, name: MARK_DISPLAY_CONTROLS.get(cp), at: i + 1 });
  });
  return hits;
}

/**
 * Every place a job carries a mark NAME, as [label, read, write] — the label is what a refusal says, so
 * it must name the field the submitter typed, not an internal one.
 */
const markNameSites = (job) => {
  const sites = [];
  for (const f of ["markName", "name"]) if (job?.[f] != null) sites.push([f, () => job[f], (v) => { job[f] = v; }]);
  if (Array.isArray(job?.marks)) job.marks.forEach((m, i) => {
    // A BARE STRING IS A MARK NAME, and this shape reaches validateJob unconverted. `assembleFromFlags`
    // turns `marks: ["AURORA"]` into `[{ name: "AURORA" }]`, so every door that assembles is already
    // covered — but the runner's wall calls validateJob({ atClaim: true }) on the MANIFEST AS IT SITS ON
    // DISK, which nothing re-assembles. The kebab-collision check below reads the same shape for exactly
    // that reason. Walking only `m.name` would leave this guard covering every door except the one it
    // exists to be a backstop for, and a string mark carrying U+202E measured as ACCEPTED before this line.
    if (typeof m === "string") sites.push([`marks[${i}]`, () => job.marks[i], (v) => { job.marks[i] = v; }]);
    else if (m?.name != null) sites.push([`marks[${i}].name`, () => m.name, (v) => { m.name = v; }]);
  });
  return sites;
};

export function validateJob(job, { atClaim = false } = {}) {
  const errs = [];
  const warnings = [];
  if (!job || typeof job !== "object") return { ok: false, errors: ["job is not an object"], warnings, classify: "reject" };
  if (!job.id) errs.push("missing id");
  // — REFUSED HERE RATHER THAN AT READ TIME. A malformed `registerFixtures` is
  // truthy, so the executor would take the fixture branch and fail deep inside a stage trying to read a
  // directory named `true`. The whole point of moving this off the environment is that a run says what
  // it is on its own record; a record that says something unreadable is worse than one that says
  // nothing, so it is refused by name at the door.
  if (job.registerFixtures != null) {
    const rf = job.registerFixtures;
    if (typeof rf !== "object" || Array.isArray(rf))
      errs.push('registerFixtures must be an object { counts?: "<dir>", records?: "<dir>" }');
    else {
      for (const k of Object.keys(rf))
        if (!["counts", "records"].includes(k)) errs.push(`registerFixtures.${k} is not a known lane (counts | records)`);
      for (const k of ["counts", "records"])
        if (rf[k] != null && (typeof rf[k] !== "string" || !rf[k].trim()))
          errs.push(`registerFixtures.${k} must be a non-empty directory path when present`);
      if (rf.counts == null && rf.records == null)
        errs.push("registerFixtures sets no lane — omit it, or name counts and/or records");
    }
  }
  // The id becomes a QUEUE FILENAME (`<id>.json` + every marker sibling) — a path-shaped id escapes the
  // queue directory (review 2026-07-17: `enqueue.mjs --id '../escaped'` wrote one level above the queue).
  // Guarded HERE so every door (CLI, start_run, raw file authors) inherits the same hardening.
  else if (String(job.id) !== String(job.id).split("/").pop() || String(job.id).includes("..") || !/^[A-Za-z0-9][A-Za-z0-9._@-]{0,180}$/.test(String(job.id)))
    errs.push(`id ${JSON.stringify(String(job.id))} must be a bare filename slug ([A-Za-z0-9._@-], no path separators) — it names the queue file and its markers`);
  // Hotfix 2026-07-06 (The Quiet Trail e2e, WhatsApp intake): a missing msgId REJECTS only when NO
  // reply path exists at all. A WhatsApp-originated job has no email thread — but with forwarderEmail
  // (or a forwarder reply-routing key) the delivery fallback ladder (: conversationId
  // → latest inbound → COMPOSE FRESH to forwarderEmail) guarantees a reply lane. Refusing a runnable
  // job over a threading nicety is the completeness-over-machinery violation this round exists to end.
  // — refuse the display-control classes by name, then collapse the rest to NFC. Here rather than
  // at a door for the reason the id guard above gives: every door (CLI, portal, start_run, the runner's
  // own wall at claim) inherits one rule and the same words.
  for (const [label, read, write] of markNameSites(job)) {
    const raw = String(read() ?? "");
    const hits = markDisplayControlsIn(raw);
    if (hits.length) {
      errs.push(`${label} contains ${hits.map((h) => `U+${h.cp.toString(16).toUpperCase().padStart(4, "0")} `
        + `${h.name} at character ${h.at}`).join(", ")} — a character that changes how the mark DISPLAYS `
        + `without changing what it says. It would reach the report, and it makes this mark compare `
        + `unequal to the one a reader sees. Resubmit the mark without it; it is not stripped for you, `
        + `because the deliverable must name the mark you asked about.`);
      continue;   // do not normalize a name that is being refused
    }
    // ── — A MARK IS A SHORT STRING, AND THIS IS WHERE THE PRODUCT KNOWS IT ──
    //
    // The owner typed a product description into the mark-name field on his own install and the product
    // accepted it, ran on it, and built its identity from it: `deriveSlug` (phase0.mjs) kebabs the mark
    // with no bound, so a 200-character paragraph became the runId, the run directory, the pool
    // directory and part of every report URL.
    //
    // NO NEW LIMIT IS INVENTED HERE. `PLAN_MAX_NAME_LENGTH` already states this product's answer to "how
    // long may a name be", and its own comment calls the budget generous — *"real marks/variants are far
    // shorter"*. What was wrong is WHERE it bit: at plan feasibility, as a `repairable` note about
    // provider truncation, long after the order was priced and confirmed. Here it is one rule at every
    // door — CLI, portal, start_run, and the runner's own wall at claim — and it bites before money.
    //
    // REFUSE, NEVER TRUNCATE, for the same reason the display-control branch above refuses: the
    // deliverable must name the mark that was asked about. A silently shortened mark is a search for
    // something the client did not ask for, which is worse than the paragraph.
    if (raw.length > PLAN_MAX_NAME_LENGTH) {
      errs.push(`${label} is ${raw.length} characters, and a mark name may be at most ${PLAN_MAX_NAME_LENGTH}. `
        + `A trademark is a short string, and this one becomes the run's identity — its directory name and `
        + `part of every report link — so it cannot carry a description. It is not shortened for you, `
        + `because the deliverable must name the mark you asked about. Send the mark itself; goods and `
        + `description belong in their own fields. It begins: "${raw.slice(0, 40)}…"`);
      continue;
    }
    // NFC only, and only when the name is otherwise clean. This changes no character a reader can see:
    // it is the difference between one mark and two matters for the same order.
    const nfc = raw.normalize("NFC");
    if (nfc !== raw) write(nfc);
  }
  if (!job.msgId && !job.forwarderEmail && !job.forwarder) errs.push("missing msgId AND forwarderEmail/forwarder — no reply path exists");
  else if (!job.msgId) warnings.push("no msgId (no email thread — e.g. a WhatsApp-originated request): delivery will compose a fresh email to forwarderEmail instead of replying in-thread");
  if (!job.forwarder) errs.push("missing forwarder (the requester/reply-routing key — rides the delivery packet)");
  // — a WARNING, never an error. This is the one place a hand-written queue file is read by code
  // that knows the vocabulary: the runner's wall calls validateJob({ atClaim: true }) on the file as it
  // sits on disk, so a field that came in around every assembling door is named here, per claim, in the
  // runner's own log. That is the record the writer census comes off.
  const undeclared = undeclaredJobFields(job);
  if (undeclared.length) warnings.push(undeclaredFieldsWarning(undeclared));
  const reject = errs.length > 0;
  // marks[] entries must carry a populated NAME — a {ref, classes}-only array has no search subject
  // (review-confirmed: with ref demoted to a warning, that shape would otherwise run a full priced
  // search on nothing instead of routing to the §B2 clarify ping).
  const hasMark = job.markName || job.name || (Array.isArray(job.marks) && job.marks.some((m) => m?.name));

  // — THE DECLARED SHAPE, HELD TO. `promptParts: true` says the prose rides as sidecar files, so a
  // manifest that declares it and carries NO prose by any route is an intake whose sidecars did not
  // arrive. Today that is accepted in silence and surfaces three steps later as "missing mark name(s)" —
  // the symptom, naming neither the declaration nor the files. The forwarding agent's observed failure
  // mode is exactly this: it mis-named a manifest `<id>.manifest.json`, the bare-base sidecars stopped
  // matching, and the job parked on a message that said nothing about sidecars (runner.mjs tolerates that
  // particular fumble now; it cannot tolerate the general case).
  //
  // A WARNING, NOT A REFUSAL, deliberately and for the same reason the undeclared-fields check warns: a
  // batch manifest can carry inline `marks[].name` and legitimately want nothing else, and refusing it
  // would break a shape nobody has complained about. What the warning buys is that the cause is NAMED
  // where it is seen. Where the job is unrunnable anyway, the error below carries the cause with it, so
  // the reader is not left to join a symptom to a declaration three steps apart.
  const declaredSidecars = job?.promptParts === true;
  const proseArrived = Object.keys(PROSE_PARTS).some((f) => String(job?.[f] ?? "").trim());
  const sidecarsMissing = declaredSidecars && !proseArrived;
  const sidecarNote = `promptParts declares the prose rides as SIDECAR files and none arrived — expected `
    + `one or more of ${Object.values(PROSE_PARTS).map((x) => `<base>${x}`).join(", ")} beside the manifest. `
    + `A mis-named manifest is the observed cause: sidecars key on the BARE base, so <base>.manifest.json `
    + `leaves them unmatched. #1085`;
  if (sidecarsMissing) warnings.push(sidecarNote);

  if (!hasMark) errs.push(sidecarsMissing ? `missing mark name(s) — ${sidecarNote}` : "missing mark name(s)");
  // Batch research artifacts key on kebab(name): two marks that differ only in spacing/punctuation/case
  // (or exact duplicates) would silently SHARE one research payload — clarify here, before any spend.
  if (Array.isArray(job.marks) && job.marks.length > 1) {
    const names = job.marks.map((m) => (typeof m === "string" ? m : m?.name)).filter(Boolean);
    const koll = kebabCollisions(names);
    if (koll.length) errs.push(`marks ${koll.map(([a, b]) => `${JSON.stringify(a)}/${JSON.stringify(b)}`).join(", ")} are duplicates or differ only in spacing/punctuation/case — each batch mark needs a distinct name; drop or reword one`);
  }
  // §B2: classes OR a goods description — either suffices; both absent ⇒ the subject can't be scoped.
  const hasClasses = requestNamesClasses(job);
  const hasGoods = Boolean(job.goods || job.use);
  if (!hasClasses && !hasGoods) {
    // — THE GATE HAS TO ASK WHAT THE RUN WOULD ASK, not what the request typed.
    //
    // This read only the request, so a knockout under a project whose overlay carries the classes was
    // refused as unscopable — the owner hit it on the first UI attempt. The refusal was not a true
    // statement about the run: classes DO inherit downstream. stages.mjs applies `profile.defaultClasses`
    // when "the request names none" (mirroring this very predicate, by its own comment), and
    // effective-scope.mjs resolves the full ladder for the preview and the register plan. So the door was
    // the only layer that had never heard of the ladder, and it was refusing runs the engine could scope.
    //
    // ONE LADDER, NOT A SECOND ONE. The three calls below are the same three the pipeline makes, in the
    // same order, so this gate cannot drift into a different opinion about where a run points — the
    // failure mode effective-scope.mjs was extracted to end. Nothing new is stamped onto the job for the
    // same reason: `classesFrom` is derived at run time from the profile's own origins, and a second copy
    // frozen into the queue file would be a second answer that has to agree forever.
    //
    // COST: this branch is only reached by a job that was ABOUT TO BE REFUSED. The happy path never loads
    // a profile, a project roster or a recipe store, so the doors are no slower than before.
    const consulted = [];
    let inherited = [], inheritedFrom = null, lookupFailed = null;
    try {
      const profiles = loadProfiles();
      const { profile: base, projectKey, origins } = resolveEffectiveProfile(job, { profiles });
      // `origins` is returned BESIDE the profile, and resolveEffectiveScope reads it AS `profile.origins`
      // — so it has to be put where that function looks or the project rung cannot be attributed and a
      // project's classes report themselves as the account's. No other call site does this, which means
      // the attribution branch in effective-scope.mjs is presently dead for all of them; that is a wider
      // bug than this gate and is raised separately rather than fixed by widening this PR.
      const profile = origins ? { ...base, origins } : base;
      consulted.push(`the customer profile ${JSON.stringify(profile?.key ?? "generic")}`);
      if (projectKey) consulted.push(`the project ${JSON.stringify(projectKey)}`);
      // The saved search is a rung above the project. `clarify` means the selector itself is wrong, which
      // the recipeKey/product checks further down report properly — here it just means no scope to read.
      const resolved = resolveSearchPolicy(job, { profile, recipes: loadRecipes({ force: true, proseGuard: recipeProseGuard }) });
      if (job.recipeKey) consulted.push(`the saved search ${JSON.stringify(String(job.recipeKey))}`);
      const scope = resolveEffectiveScope(job, profile, resolved?.clarify ? null : resolved);
      inherited = Array.isArray(scope?.classes) ? scope.classes : [];
      inheritedFrom = scope?.classesFrom ?? null;
    } catch (e) {
      // FAIL CLOSED AT INTAKE, and say so. The projectKey check above fails OPEN on infra trouble because
      // letting a job through costs a mis-scoped label the runner re-checks; here it would cost an
      // unscoped SEARCH, which is the one thing §B2 exists to prevent. At intake that costs nothing that
      // ran before: a job with request classes or goods never reaches this branch at all.
      //
      // AT CLAIM IT IS A WARNING, for the reason the archived-project rule above gives in its own words —
      // archive is "stop offering this", not "cancel what is already agreed". validateJob runs twice, and
      // an error on the claim path reaches failAtIntake: the job parks as .failed and the requester is
      // notified. Before this gate consulted the ladder no such job could BE in the queue, so fail-closed
      // was free; now that one can be admitted on an inherited scope, refusing here destroys work that was
      // legitimately accepted — over a store read that failed, which is a failure to look and not a
      // finding that the scope is gone. loadProfiles() throws for EVERY job when any one bundle in the
      // store is malformed, so this is a store-wide outage parking unrelated accepted work.
      lookupFailed = e?.message ?? String(e);
    }
    if (inherited.length) {
      // ADMITTED, AND SAID OUT LOUD. The requester typed no classes and the run will be scoped by some
      // other layer's — under D4.1 ("never silently run a different search than the one that was asked
      // for") the answer is to proceed and record which layer, not to refuse and not to stay quiet.
      warnings.push(`no classes or goods in the request: this run is scoped to Nice class${inherited.length === 1 ? "" : "es"} ${inherited.join(", ")} from ${inheritedFrom}`);
    } else if (lookupFailed) {
      const why = `the customer profile could not be read to see whether it supplies any (${lookupFailed}). This is a failure to look, not a finding that nothing is set`;
      if (atClaim) warnings.push(`the request names no classes or goods and ${why} — allowed through because this job was already admitted, and a store that cannot be read is not evidence its scope is gone`);
      else errs.push(`missing classes AND goods description (either one suffices) — and ${why}`);
    } else {
      errs.push(`missing classes AND goods description (either one suffices) — ${consulted.length ? `consulted ${consulted.join(", ")}, and none names default classes` : "no customer profile resolved to inherit any from"}`);
    }
  }
  // ── per-run SCOPE ───────────────────────────────────────────────────────────────────────────────────
  // Scope says WHERE the machinery points. The selectors below say WHICH machinery runs. Both are
  // instructions about the SEARCH and never about the RATING — the framework, appetite and delivery that
  // rate a matter stay customer-owned and out of a job's reach by construction.
  //
  // All three CLARIFY rather than warn, for one shared reason: each can be wrong in a way that produces a
  // confident report about the wrong thing without ever announcing itself. A typo'd territory searches
  // the wrong country, an out-of-range class searches nothing, a mistyped domain quietly drops a
  // marketplace from the grid. That is the D4.1 discipline — never silently run a different search than
  // the one that was asked for.
  if (job.classes != null) {
    if (!Array.isArray(job.classes)) errs.push("classes must be an array of Nice class numbers");
    else errs.push(...niceClassErrors(job.classes, "classes"));
  }
  if (Array.isArray(job.marks)) {
    for (const m of job.marks) {
      if (m?.classes != null && !Array.isArray(m.classes)) errs.push(`marks entry ${JSON.stringify(m?.name ?? m)} has classes that are not an array`);
      else if (Array.isArray(m?.classes)) errs.push(...niceClassErrors(m.classes, `marks ${JSON.stringify(m?.name ?? "")} classes`));
    }
  }
  // jurisdictions — the INSTRUCTED territories. Already consumed everywhere (stages.mjs scopeTerritories
  // frames them as AUTHORITATIVE scope, jx-lanes.mjs scopeJurisdictions picks the deepening lanes,
  // register-plan.mjs derives its regions), always as instructed-wins-else-profile-defaults. What was
  // missing was any check at the doors, so this validates the shape those consumers already assume.
  // Vocabulary stays PROSE-TOLERANT ("US", "United Kingdom"): every consumer either uppercases or renders
  // it as prose, and none requires an ISO code. Imposing one here would reject requests the engine runs.
  //
  // ── WHICH PRODUCT, read FIRST, because the geography rules below are the product's own ─────────────
  // The two selectors: a product from the offering, or a saved search that carries one. Parsed here
  // rather than beside their own checks (further down) because "worldwide" is not a geography a request
  // chooses independently of what it ordered — a Global preliminary search IS worldwide, and the stamp
  // has to know that before it can be written.
  const rawProduct = job.product != null ? String(job.product).trim().toLowerCase() : "";
  const rawRecipe = job.recipeKey != null ? String(job.recipeKey).trim().toLowerCase() : "";
  // The row is looked up only for a product the offering actually lists. A typo'd one is refused by name
  // below; judging its geography first would be answering questions about a product that does not exist.
  const orderedProduct = ORDERABLE_PRODUCTS.includes(rawProduct) && !rawRecipe ? rawProduct : null;
  const orderedSpec = orderedProduct ? productSpec(orderedProduct) : null;
  // Set below when the requester named ONLY worldwide tokens. "Everywhere" is a positive instruction, and
  // the geography stamp further down is where it survives as one.
  let askedWorldwide = false;
  if (job.jurisdictions != null) {
    // A bare string becomes a one-element array HERE, because the consumers disagree about it and the
    // disagreement is silent: stages.mjs accepts a bare string, jx-lanes.mjs tests Array.isArray and
    // falls through to the profile's defaults for anything else. So a string-valued job frames on the
    // instructed territory and deepens on a different set. One shape at the door ends that.
    if (typeof job.jurisdictions === "string" && job.jurisdictions.trim()) job.jurisdictions = [job.jurisdictions];
    if (!Array.isArray(job.jurisdictions)) {
      errs.push(`jurisdictions ${JSON.stringify(job.jurisdictions)} must be an array of territories (e.g. ["US","EU"]) — omit it to search the customer's default territories`);
    } else {
      const bad = job.jurisdictions.filter((x) => typeof x !== "string" || !x.trim() || x.trim().length < 2 || x.trim().length > 40);
      if (bad.length) errs.push(`jurisdictions ${bad.map((x) => JSON.stringify(x)).join(", ")} — each territory is a non-empty name or code of 2–40 characters`);
      else {
        // Deduped case-insensitively, FIRST SPELLING WINS, and normalized in place so every consumer
        // sees one list (the parentRunId precedent: the promise has to match the mutation).
        const seen = new Set();
        const kept = [];
        for (const raw of job.jurisdictions) {
          const t = raw.trim();
          const k = t.toUpperCase();
          if (seen.has(k)) continue;
          seen.add(k);
          kept.push(t);
        }
        if (kept.length !== job.jurisdictions.length) warnings.push(`jurisdictions listed the same territory more than once — searching ${kept.length} distinct territor${kept.length === 1 ? "y" : "ies"}`);
        // "Worldwide" is never a list ENTRY — it is a mode, and it is now recorded as one (the
        // geography stamp below). The token still comes off the list here: it framed as a bogus
        // TERRITORY named "WORLDWIDE" in scopeTerritories, routed no lane, and counted as one territory
        // against the deep-dive rule. Cleared so every consumer sees one shape; recorded so the request
        // is not confused with a request that said nothing at all.
        //
        // We are NOT widening Worldwide to imply CN/JP/KR: jx-lanes.mjs scopeJurisdictions reserves that
        // as a product decision, and an empty scope fires no lanes — which is exactly what the portal's
        // own "clear the territories" state (composer addTerritory / compose-read) already means.
        const { worldwide, named } = partitionTerritories(kept);
        // The cap counts what would actually be SEARCHED, which is why it sits after the partition
        // rather than before it: 20 real territories plus a "Worldwide" the door is about to discard
        // was refused as 21, a number the requester cannot reconcile with what they sent (review
        // 2026-07-27). Territory tokens are echoed JSON-stringified for the same reason the entry
        // errors above are — a clarify rides reason files, outbox packets and log lines.
        if (named.length > MAX_JURISDICTIONS) errs.push(`jurisdictions names ${named.length} territories (max ${MAX_JURISDICTIONS} per search) — narrow the request, or raise the account's default territories in its profile where the number is visible`);
        else if (worldwide.length && named.length) {
          warnings.push(`jurisdictions listed ${worldwide.map((t) => JSON.stringify(t)).join(", ")} alongside named territories — worldwide is not a list entry; the named territories win (searching ${named.map((t) => JSON.stringify(t)).join(", ")})`);
          job.jurisdictions = named;
        } else if (worldwide.length) {
          // The token leaves the list and becomes the MODE. It used to leave the list and become
          // nothing — byte-identical to a request that never mentioned geography, which then fell
          // through to the account's default territories. An account with seven default territories
          // sold a worldwide search and ran a seven-country one, and no field anywhere disagreed.
          askedWorldwide = true;
          warnings.push(`jurisdictions named only ${worldwide.map((t) => JSON.stringify(t)).join(", ")} — worldwide is not a list entry; recorded as a worldwide search (no territory restriction, and the account's default territories do not narrow it)`);
          delete job.jurisdictions;
        } else job.jurisdictions = kept;
      }
    }
  }
  // ── the GEOGRAPHY STAMP: what the requester asked for about WHERE, recorded once, at the door ───────
  //
  // Three states that used to be one. `jurisdictions` absent meant BOTH "search everywhere" and "I said
  // nothing about geography", because the worldwide tokens were deleted off the list and left no trace.
  // Those resolve differently — everywhere is everywhere; silence falls through to the account's default
  // territories — and the engine could not tell them apart on the wire.
  //
  //   worldwide        the requester asked for no territorial restriction. It WINS: effective-scope.mjs
  //                    short-circuits before the account rung, so defaults cannot narrow it.
  //   named            the requester named the territories now in job.jurisdictions
  //   account-default  the requester named none — whatever the account (or a saved search) supplies
  //
  // `origin` is WHICH LAYER supplied job.jurisdictions when the request was STORED. A door is the only
  // thing that sees a requester, so it is "request" or "account-default" here; the field exists because
  // job.jurisdictions is mutated later (foldRecipeScope writes a saved search's territories into it on
  // every pass, after this validator has run), and provenance recomputed at read time from a profile
  // that has since been edited is provenance about a request nobody made.
  //
  // AN ABSENT STAMP IS ITS OWN STATE — "unrecorded" — AND NEVER THE DEFAULT.
  // A job queued or archived before this field existed has none of it. That job's geographic intent was
  // never captured and cannot be recovered, so it is not stamped: it resolves down the ladder exactly as
  // it always did (effective-scope.mjs reports geographyMode "unrecorded"). Stamping it here would be
  // inventing the one fact it is missing. That is why the stamp is gated on `atClaim` — at a door we are
  // reading a request, at claim we are reading a stored file, and only one of those can be asked.
  //
  // WITH ONE EXCEPTION, AND IT IS THE BRANCH THE JUSTIFICATION DOES NOT COVER. When `askedWorldwide` is
  // true the fact is NOT missing: the requester wrote it in `jurisdictions` and the block above just
  // deleted it off the list. Anything that writes a valid job file reaches the runner (INTAKE.md), and
  // that job was claimed, told "recorded as a worldwide search (no territory restriction, and the
  // account's default territories do not narrow it)" in the run log, and then resolved through the
  // account rung to its default territories — the exact incident the stamp exists to end, reproduced on
  // the claim path with a warning in the log asserting it did not happen. `worldwide` is the ONLY mode
  // that may be written here; "named" and "account-default" really would be inventions, and are not.
  if (job.geography != null) {
    // A door that states it explicitly is believed and checked, not re-derived.
    if (typeof job.geography !== "object" || Array.isArray(job.geography)) {
      errs.push(`geography ${JSON.stringify(job.geography)} must be an object stating the geography mode (e.g. {"mode":"worldwide"})`);
    } else if (!GEOGRAPHY_MODES.includes(job.geography.mode)) {
      errs.push(`geography.mode ${JSON.stringify(job.geography.mode ?? null)} must be one of ${GEOGRAPHY_MODES.map((m) => JSON.stringify(m)).join(", ")}`);
    } else if (job.geography.mode === "worldwide" && Array.isArray(job.jurisdictions) && job.jurisdictions.length) {
      // Not resolvable by picking a side. A worldwide search accepts no narrowing at all, so a request
      // that asks for both has two answers and the door must not choose one of them silently — the
      // failure this whole stamp exists to end, arriving from the other direction.
      errs.push(`geography.mode "worldwide" was sent alongside ${job.jurisdictions.length} named territor${job.jurisdictions.length === 1 ? "y" : "ies"} (${job.jurisdictions.map((t) => JSON.stringify(String(t).slice(0, 40))).join(", ")}) — a worldwide search is not narrowed. Drop the territories to search everywhere, or send geography.mode "named" to search only those`);
    } else if (job.geography.mode !== "worldwide" && askedWorldwide) {
      // The mirror of the rule above, and the one that hides better: the requester wrote "Worldwide" in
      // jurisdictions, the token came off the list, and a stamp saying anything else would bury the only
      // record that they asked for everywhere. Silently discarding it is how the whole ambiguity started.
      errs.push(`jurisdictions asked for worldwide but geography.mode says ${JSON.stringify(job.geography.mode)} — those are different searches. Send geography.mode "worldwide" to search everywhere, or name the territories to search instead`);
    } else if (job.geography.mode === "named" && !(Array.isArray(job.jurisdictions) && job.jurisdictions.length)) {
      errs.push(`geography.mode "named" was sent with no territories in jurisdictions — name the territories to search, or send geography.mode "account-default" to use the account's own`);
    } else if (job.geography.origin != null && !GEOGRAPHY_ORIGINS.includes(job.geography.origin)) {
      errs.push(`geography.origin ${JSON.stringify(job.geography.origin)} must be one of ${GEOGRAPHY_ORIGINS.map((o) => JSON.stringify(o)).join(", ")}`);
    } else {
      job.geography = { mode: job.geography.mode, origin: job.geography.origin ?? (job.geography.mode === "account-default" ? "account-default" : "request") };
    }
  } else if (atClaim) {
    // See the exception above: at claim the ONLY recoverable fact is a worldwide token the door just
    // struck off the list, and it is the one that must not be lost.
    if (askedWorldwide) job.geography = { mode: "worldwide", origin: "request" };
  } else {
    // THE PRODUCT DECIDES WHEN THE PRODUCT IS WORLDWIDE. A Global preliminary search does not merely
    // ACCEPT worldwide, it IS worldwide — so a request that ordered one and named no territories has
    // asked for everywhere, and stamping "account-default" there would send it down the ladder into the
    // account's own territories and run a narrower search than the one that was bought. That is the
    // failure the stamp exists to end, arriving through the product instead of through the token.
    const worldwideByProduct = orderedSpec?.geography === "worldwide, and nothing else"
      && !(Array.isArray(job.jurisdictions) && job.jurisdictions.length);
    const mode = askedWorldwide || worldwideByProduct ? "worldwide"
      : (Array.isArray(job.jurisdictions) && job.jurisdictions.length ? "named" : "account-default");
    job.geography = { mode, origin: mode === "account-default" ? "account-default" : "request" };
  }
  // ── THE OFFERING'S OWN RULES, at the one door all four share ────────────────────────────────────────
  //
  // WHY HERE AND NOT AT EACH DOOR. validateJob is the only thing the portal, start_run, the CLI and the
  // runner all call (portal-service planGates, ops.mjs startRun, enqueue.mjs main, runner claimAndPrep).
  // Every other check in this build lives at one or two of them: `checkClearanceScopeRules` runs at the
  // runner, the portal and plan_run but at neither start_run nor the CLI; the mark budget and the
  // availability gate run at the runner alone. A rule placed at a door is a rule the other doors do not
  // have, and 's acceptance test is that all three refuse the same request in the same words.
  //
  // WHAT IS JUDGED HERE: everything the REQUEST states. Each of the offering's illegal shapes is visible
  // without resolving anything — a narrowed Global preliminary, a two-country Full country search, a
  // region where a country is required, a worldwide Multi-country focus, the native-language toggle on a
  // product that does not carry it, more names than the product reads. What is NOT judged here is a scope
  // that only exists after the account's defaults are folded in; that is the runner's wall and the plan
  // doors' courtesy, on the RESOLVED scope, with the same sentences from the same module.
  if (rawProduct && rawRecipe)
    errs.push(`both product (${JSON.stringify(rawProduct)}) and recipeKey (${JSON.stringify(rawRecipe)}) are set — name ONE selector (a saved search already carries its product)`);
  if (rawProduct && !ORDERABLE_PRODUCTS.includes(rawProduct))
    errs.push(unknownProductMessage(job.product));
  // caseLaw: NOT A REQUEST FIELD ANY MORE (owner ruling 2026-08-06). It is what a Full country search IS.
  // REFUSED rather than ignored, and that is the whole point: a flag accepted and dropped is the
  // "accepted, then quietly narrower" shape — a requester who sent it believes they bought the deep
  // reading. The sentence names the product that carries it, so the refusal is one edit away from a
  // working request. `false` is refused too: it never suppressed anything, and silently accepting it
  // would let someone believe they had turned a stage off.
  if ("caseLaw" in job && job.caseLaw != null) errs.push(CASE_LAW_NOT_A_REQUEST.message);
  // The selector itself. Deleted by and refused by nothing — accepted, dropped, and the run went out
  // at whatever product the SCOPE implied. Same doctrine as the line above, on the field that decided
  // which search somebody bought. `null` is included: sending the key at all means the caller is on the
  // retired wire and needs to hear so.
  if ("searchLevel" in job) errs.push(SEARCH_LEVEL_NOT_A_REQUEST.message);
  // nativeLanguage: the ONE toggle in the offering. Shape first, then the two ways it can be wrong.
  if ("nativeLanguage" in job && job.nativeLanguage != null && typeof job.nativeLanguage !== "boolean")
    errs.push(`nativeLanguage ${JSON.stringify(job.nativeLanguage)} must be a boolean — true adds the native-language investigation to a ${productName("multi-country-focus-search")}`);
  // `false` is REFUSED, not dropped — the caseLaw rule on the sibling toggle. The toggle only ever added,
  // so `false` asked to remove something no product runs conditionally, and all four assembling doors
  // dropped it: a requester who sent it on a Full country search believed they had switched the
  // investigation off and was billed for one that ran it. products.mjs owns the sentence.
  else if (job.nativeLanguage === false) errs.push(NATIVE_LANGUAGE_NOT_A_SUPPRESSION.message);
  else if (job.nativeLanguage === true && orderedProduct) {
    const verdict = checkNativeLanguage({ product: orderedProduct });
    if (!verdict.ok) errs.push(verdict.message);
  }
  if (orderedProduct) {
    // GEOGRAPHY. Judged against what the REQUEST says about where, which is exactly `geography.mode`
    // plus the named list — never against the account's defaults, which this door cannot see and the
    // wall re-checks.
    const mode = job.geography?.mode ?? null;
    const named = Array.isArray(job.jurisdictions) ? job.jurisdictions : [];
    if (mode === "worldwide" || mode === "named") {
      const verdict = checkProductScope({ product: orderedProduct, territories: mode === "worldwide" ? [] : named });
      if (!verdict.ok) errs.push(verdict.message);
    } else if (mode === "account-default" && orderedSpec?.geography === "worldwide, and nothing else") {
      // The one shape the stamp above cannot fix: a request that ORDERED a worldwide search and
      // explicitly said "use the account's territories". Those are two different searches and the door
      // must not pick one of them silently — the account's list would narrow a product that accepts no
      // narrowing.
      errs.push(`a ${productName("global-preliminary-search")} is worldwide and accepts no narrowing — this request asks for the account's own default territories instead. Drop the geography to search worldwide, or order a ${productName("multi-country-focus-search")} over those territories`);
    }
    // NAME COUNT, and SCOPE-vs-MACHINERY. Both on the ordered product, which is the only one this door
    // can know; the runner re-checks the RESOLVED product, where an account default is finally visible.
    const policy = policyFor(orderedProduct);
    const budget = checkMarkBudget(job, policy);
    errs.push(...budget.errors);
    warnings.push(...budget.warnings);
    const fit = checkScopeAgainstPolicy(job, policy);
    errs.push(...fit.errors);
    warnings.push(...fit.warnings);
  }
  // platforms — marketplaces to sweep IN ADDITION to the account's own. ADDITIVE ONLY, and enforced as
  // such where the union happens: a client's platforms are a client MANDATE (the 2026-07-18 Racers
  // Paradise run searched house platforms instead of the client's), so a per-run list can widen the grid
  // and can never shrink it. Same per-entry rules as a profile's, shared via platformEntryErrors.
  if (job.platforms != null) {
    if (!Array.isArray(job.platforms)) errs.push("platforms must be an array of bare store domains (e.g. [\"gnc.com\"]) — they are ADDED to the account's marketplaces, never a replacement for them");
    else if (job.platforms.length > MAX_RUN_PLATFORMS) errs.push(`platforms names ${job.platforms.length} marketplaces (max ${MAX_RUN_PLATFORMS} per search) — every extra platform raises the grid floor for every variant; put a standing list in the account's profile instead`);
    else errs.push(...platformEntryErrors(job.platforms, { label: "platforms" }));
  }
  // D2 — intake binding: an UNRESOLVED applicant (customerUnknown) is NEVER blocking (2026-06-18). A clearance
  // can always run without a named applicant — the pipeline uses the generic profile, arms the late-bind watch,
  // and reports any identical/near-identical hit as an ordinary finding with a neutral "if this is the
  // applicant's own prior filing, disregard" note (see pipeline.mjs / stages.mjs). The old gate that clarified
  // when there were no instructions contradicted the intake ACK (which already promises the search proceeds)
  // and is gone; a missing applicant is now a proceed-with-default warning, not an error. (`hasInstructions`
  // retained only to phrase the note when the run is on bare defaults.)
  const hasInstructions = Boolean((job.upfrontInstructions && String(job.upfrontInstructions).trim())
    || (job.deliverableSpec && String(job.deliverableSpec).trim()));
  if (job.customerUnknown === true && !hasInstructions)
    warnings.push("unresolved applicant (customerUnknown) and no instructions — proceeding on defaults; identical hits are reported as ordinary findings with a 'if this is the applicant's own filing, disregard' note (never blocks)");
  // D4.1 — the intake AI resolves WHICH customer this clearance is for and stamps the profile key; validate
  // it names a REAL customer (a typo / hallucinated key must clarify, never silently mis-route to generic on
  // a paid run). Roster is the source of truth; infra trouble reading it never blocks intake.
  if (job.profileKey != null && String(job.profileKey).trim()) {
    let known = false;
    let roster = [];
    try {
      const profiles = loadProfiles();
      known = profiles.has(String(job.profileKey).trim());
      roster = [...profiles.keys()].sort();
    } catch { known = true; }
    // NAME THE ROSTER THIS PROCESS CAN SEE, always.
    //
    // "names no known customer" on its own points at the customer, and the customer is usually fine.
    // The real cause is far more often that THIS process is reading a different profiles directory
    // from the one that enrolled them — loadProfiles falls back to the bundled demo roster when
    // CLEAROTRON_CUSTOMERS_DIR is unset, silently (driver/profiles.mjs header; and 2026-07-22, when the
    // portal's trigger door had neither the variable nor the shared env file and refused the first
    // clearance ever started from the portal). Reading the roster back is what makes the difference
    // between the two obvious: a real store lists your customers, the fallback lists four demo ones.
    // `resolveProfile` has done this for a while — this is the same courtesy at the earlier gate.
    if (!known) {
      errs.push(`profileKey "${job.profileKey}" names no known customer — the roster this process can see is `
        + `[${roster.join(", ") || "empty"}]. If those are not your customers, the profiles directory is wrong `
        + `(check CLEAROTRON_CUSTOMERS_DIR); otherwise clarify which customer this is for, or omit it to use the generic profile`);
    }
  }
  // THE OTHER HALF OF D4.1: a customer NAMED IN PROSE with no account key at all.
  //
  // resolveProfile is asymmetric. A WRONG key throws loudly — "refusing to silently fall back to generic:
  // that would drop the customer's platforms, self-exclusion seed and the framework that RATES the matter".
  // A MISSING key returns generic in silence. Both produce the same wrong deliverable, and only one says so.
  //
  // It has already happened: a paid Zephyr Beverages clearance was rated on the Generic default scale because the
  // request named the customer in prose and left the account field empty. Nothing objected. A person
  // noticed hours later and re-ran it.
  //
  // WHY THIS IS NOT SIMPLY "customer present, key absent". That shape is byte-identical to a LEGITIMATE
  // third-party search — a firm asking us to clear a mark for their own client, who is not our account —
  // and the applicant deliberately never selects a profile, because a third-party search must never inherit
  // a customer's exclusions. Clarifying on that shape alone would bounce real work every day.
  //
  // The discriminator is the ROSTER. The Zephyr Beverages request differed in one way that matters: we hold an
  // account by that name. A named applicant we have no account for is a third-party search and runs
  // untouched; a named applicant who IS one of our customers, with no key, is ambiguous in a way only a
  // person can settle — did intake forget to tag it, or is this genuinely a search against a name that
  // happens to be ours? Both readings are plausible, which is exactly what a clarify is for.
  //
  // This is NOT an authorisation check. Nothing here asks whether the requester is entitled to act for the
  // customer; it asks which rulebook to rate under, and refuses to guess when the answer is ambiguous.
  //
  // Matching is applicantMatchesProfile — word-boundary containment, never fuzzy — the same comparison the
  // own-rights guard already uses to decide whether an applicant IS the profile's customer. Fail-open on a
  // roster read, exactly like the key check above: infrastructure trouble must never block intake.
  if (!(job.profileKey != null && String(job.profileKey).trim()) && String(job.customer ?? "").trim()) {
    let hit = null;
    try {
      for (const [k, p] of loadProfiles()) {
        if (k === "generic") continue;
        if (applicantMatchesProfile(p, job.customer)) { hit = { key: k, name: p.name }; break; }
      }
    } catch { hit = null; }
    if (hit)
      errs.push(`customer "${String(job.customer).trim()}" names an account we hold ("${hit.name}", key "${hit.key}") but no profileKey was set — `
        + `the run would be rated on the GENERIC DEFAULT scale, not theirs. Set profileKey:"${hit.key}" to run it as ${hit.name}, `
        + `or confirm this is a third-party search for an unrelated applicant of the same name (then it runs on the generic profile as-is)`);
  }
  // spec 62 — a project is a SPARSE OVERLAY under a customer. When the intake AI stamps a projectKey, validate it
  // names a real project UNDER the resolved customer (the same D4.1 discipline as profileKey: a valid-but-unknown
  // or unscoped key must CLARIFY, never silently drop to the customer profile on a paid run). Absent ⇒ runs on the
  // customer profile as now, no warning (spec 62: "nothing in between"). Infra trouble reading the roster never blocks.
  if (job.projectKey != null && String(job.projectKey).trim()) {
    const pk = String(job.projectKey).trim();
    let known = false, archived = false;
    try {
      const profiles = loadProfiles();
      const customer = resolveProfile(job, { profiles });   // named customer from profileKey/forwarderDomain, else generic
      // a project can only overlay a NAMED customer — generic has no engagements to scope one under.
      const overlay = (!!customer && customer.key !== "generic")
        ? loadProjects({ profiles }).get(`${customer.key}/${pk}`) : null;
      known = !!overlay;
      archived = Boolean(overlay?.archived);
    } catch { known = true; }
    if (!known) errs.push(`projectKey "${pk}" names no known project under this customer — clarify which project (engagement) this clearance is for, or omit it to run on the customer profile`);
    // ARCHIVED is a distinct answer from UNKNOWN: the project exists and its history is intact, it is just
    // no longer offered for NEW work. Saying "no known project" would send someone hunting for a typo that
    // is not there. Mirrors the saved-search clarify in search-policy.mjs ("… is archived — un-archive it
    // or name a built-in level").
    //
    // ARCHIVING IS NOT RETROACTIVE, and that is why this is gated on `atClaim`. validateJob runs twice:
    // once at intake, and again at claim (runner.mjs) when the job is picked up. An error at claim reaches
    // failAtIntake — the job parks as .failed and the requester is notified — so archiving a project while
    // a job was sitting in the queue would destroy work that was legitimately accepted, possibly days
    // earlier. Archive is "stop offering this", not "cancel what is already agreed".
    //
    // Nothing is silently mis-scoped by letting it through: resolveEffectiveProfile still resolves an
    // archived overlay (profiles.mjs, and profiles.test.mjs pins it), so the queued run gets exactly the
    // configuration it was admitted under, and the report still discloses `run_under_project`. The claim
    // path records a warning so the choice is visible in the run log rather than merely implied here.
    else if (archived && !atClaim) errs.push(`projectKey "${pk}" is archived — un-archive the project, name a live one, or omit it to run on the customer profile`);
    else if (archived) warnings.push(`projectKey "${pk}" was archived after this job was queued — running it anyway on the overlay it was admitted under; archiving stops NEW requests, it does not cancel accepted work`);
  }
  // The saved-search selector. The discipline is the profileKey one (D4.1): a typo'd/unknown selector
  // must CLARIFY, never silently run a different-priced product.
  // untrusted tokens echo JSON-stringified — these messages ride reason files/outbox packets/log lines
  if (rawRecipe) {
    if (!/^[a-z0-9][a-z0-9-]*(\/[a-z0-9][a-z0-9-]*)?$/.test(rawRecipe)) {
      errs.push(`recipeKey ${JSON.stringify(String(job.recipeKey))} is not a recipe slug (lowercase [a-z0-9-], optionally "customer/slug")`);
    } else {
      // Existence against the recipe store, customer-scoped (same fail-open posture as the roster checks:
      // infra trouble reading the store never blocks intake — the runner's admission gate re-resolves).
      let known = false;
      try {
        const customer = resolveProfile(job, { profiles: loadProfiles() });
        const key = rawRecipe.includes("/") ? rawRecipe : `${customer?.key ?? "generic"}/${rawRecipe}`;
        known = loadRecipes({ force: true, proseGuard: recipeProseGuard }).has(key);   // live store, D1-guarded (a guard throw = infra-trouble ⇒ fail-open here; the runner door re-checks loud)
      } catch { known = true; }
      if (!known) errs.push(`recipeKey ${JSON.stringify(rawRecipe)} names no saved search for this customer — check the saved-search list, or name a product instead`);
    }
  }
  // deliveryRoute (optional): how the delivered packet leaves — "email" (today's courier behavior) or
  // "portal" (mark_sent without an email send). A bad value could mis-deliver a finished report → clarify.
  if (job.deliveryRoute != null && !["email", "portal"].includes(String(job.deliveryRoute).trim().toLowerCase()))
    errs.push(`deliveryRoute ${JSON.stringify(String(job.deliveryRoute))} must be "email" or "portal" (or omitted for email)`);
  // parentRunId (optional, escalation lineage): records which run this one escalates from. No consumer
  // resolves it yet (the artifact-carry lands with the escalation phase) — a malformed value is a warning
  // and is ACTUALLY unset here (review 2026-07-17: the promise must match the mutation, or the verbatim
  // string survives into the sidecar/meta); a valid value is normalized in place. The freeze re-checks
  // the same shape belt-and-braces (a raw queue file bypasses this validator's mutation on some paths).
  if (job.parentRunId != null) {
    const pid = String(job.parentRunId).trim().toLowerCase();
    if (/^[a-z0-9][a-z0-9-]{1,80}$/.test(pid)) job.parentRunId = pid;
    else {
      warnings.push(`parentRunId ${JSON.stringify(job.parentRunId)} does not look like a runId (slug expected) — treating as unset; escalation lineage will not be recorded`);
      delete job.parentRunId;
    }
  }
  // deadline (optional): drives the §A3 deadline-envelope arithmetic, and nothing downstream checks it —
  // a malformed value has until now flowed straight into date maths and come out the other side as a
  // confidently wrong turnaround promise. Handled exactly like parentRunId: never blocks (a date typo
  // must not stop a runnable search), says so loudly, and is ACTUALLY unset rather than left to survive
  // into the envelope. A bare calendar date is accepted and read as end of that day, UTC.
  if (job.deadline != null && String(job.deadline).trim()) {
    const raw = String(job.deadline).trim();
    const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(raw);
    const t = Date.parse(dateOnly ? `${raw}T23:59:59Z` : raw);
    if (!Number.isFinite(t)) {
      warnings.push(`deadline ${JSON.stringify(job.deadline)} is not a date we can read (expected ISO-8601, e.g. "2026-06-20T17:00:00Z" or "2026-06-20") — treating as unset; no deadline envelope will be applied`);
      delete job.deadline;
    } else if (dateOnly) {
      job.deadline = new Date(t).toISOString();
    }
  }
  if (!job.ref && !job.tmp) warnings.push("no ref/tmp (TMP Reference No.) — proceeding with no reference");
  // Repair-first phase 3 (the teal-causeway msgId defect): a 32-hex msgId is the SANITIZED HASH base
  // (the job-id derivation), not a Graph message id — the delivery send-tool's inReplyTo lookup will fail and the
  // notice/delivery falls back off the client thread. Never blocks (still deliverable via fallback);
  // named loudly so the email-loop manifest discipline is fixable at the source.
  if (job.msgId && /^[0-9a-f]{32}$/i.test(String(job.msgId).trim()))
    warnings.push(`msgId "${String(job.msgId).slice(0, 8)}…" is a 32-hex sanitized hash, not a Graph message id (AAMk…) — reply-to-thread will fail; email-loop must pass the mail-read tool's id field VERBATIM`);
  if ("customerUnknown" in job && typeof job.customerUnknown !== "boolean")
    warnings.push("customerUnknown should be a boolean (B5) — treating as unset");
  // dupOverride: opt-in force-run past the matter-dedup gate (runner.mjs claimAndPrep). Optional boolean;
  // a non-boolean is a soft warning treated as unset (never blocks) — matches the customerUnknown handling.
  if ("dupOverride" in job && typeof job.dupOverride !== "boolean")
    warnings.push("dupOverride should be a boolean (force-run past dedup) — treating as unset");
  // — demoRun REFUSES a bad shape rather than warning and unsetting, and the departure
  // from its two neighbours above is the point. `customerUnknown` and `dupOverride` are operational
  // toggles: read one wrong and a run is dispatched slightly differently. `demoRun` decides whether the
  // report SAYS IT IS FICTION. A malformed value is truthy — "false", "no" and 0 have all reached
  // manifests by hand — so warn-and-unset would either brand a real report fiction or let a demo account's
  // report claim to be real, on a value nobody typed deliberately. Refused at the door, where the
  // requester can still read the sentence, rather than dying deep in a stage.
  {
    const shape = demoRunShape(job.demoRun);
    if (!shape.ok) errs.push(shape.reject);
  }
  const classify = reject ? "reject" : errs.length ? "clarify" : "run";
  return { ok: errs.length === 0, errors: errs, warnings, classify };
}

// The ASSEMBLED job shape validateJob() sees. Since 2026-06-16 the email-loop no longer hand-writes this whole
// object as one JSON file: prose fields (markName, brief, rawRequest, goods, upfrontInstructions, deliverableSpec,
// commercialFlexibility, priorUse, campaignShape) are written as raw plain-text SIDECARS (<base>.brief.md, …) so the agent never
// escapes verbatim prose, and runner.mjs assembleJob() overlays them onto the scalar <base>.json manifest. A
// self-contained legacy job (all fields inline, no sidecars) still validates identically — assembly is a no-op then.
export const EXAMPLE_JOB = {
  id: "AAMkAGI2-example-msgid",
  msgId: "<AAMkAGI2...@example.com>",
  forwarder: "jordan",
  forwarderEmail: "jordan.lee@example.com",
  forwarderDomain: "example.com",
  provider: "corsearch",
  marks: [{ ref: "TMP-2201", name: "NOVAPULSE", classes: [9, 41] }],
  ref: "TMP-2201",                       // OPTIONAL — a missing reference never blocks (§B2)
  markName: "NOVAPULSE",
  classes: [9, 41],
  goods: "downloadable game software; online entertainment services",  // classes OR goods — either suffices
  jurisdictions: ["US", "EU", "JP"],    // per-run SCOPE: the INSTRUCTED territories, and what makes a
                                        // clearance one product rather than another (three territories
                                        // is a Multi-country focus search). Authoritative — the matter
                                        // frame must not widen past them. Prose or codes both read
                                        // ("US", "United Kingdom"); max 20. Worldwide is never an ENTRY:
                                        // "Worldwide"/"global"/"all" are cleared here and recorded as
                                        // the geography MODE below.
  geography: { mode: "named", origin: "request" },
                                        // WHAT THE REQUESTER ASKED ABOUT WHERE, stamped at the door.
                                        // "worldwide" wins over every default; "named" is the list
                                        // above; "account-default" is the requester saying nothing. A
                                        // door writes this — a caller may state it and is then checked
                                        // against the list, never silently corrected.
  // platforms: ["gnc.com"],            // OPTIONAL per-run SCOPE: marketplaces swept IN ADDITION to the
                                        // account's own. ADDITIVE ONLY — a client's platforms are a
                                        // mandate, so a job can widen the common-law grid, never shrink
                                        // it. Bare store domains, max 10; "web" is implicit.
  upfrontInstructions: "Standard preliminary search; focus EU + US + key Asia markets.",
  // change-spec v3 intake fields (§A5 + §B1/B3) — written by the email-loop confirmation gate:
  rawRequest: "<the verbatim forwarded email text, untouched — archived as inbound-request.txt (§A5)>",
  brief: "<the confirmation brief exactly as sent to the requester — archived as confirmation-brief.md>",
  deadline: "2026-06-20T17:00:00Z",     // optional; drives the §A3 deadline-envelope arithmetic
  profileKey: "aurora",              // D4.1: the customer ACCOUNT the intake AI resolved → selects the
                                        // profile (marketplaces/classes/delivery/appetite); omit ⇒ generic
  product: "multi-country-focus-search",// WHICH OF THE FOUR (OPTIONAL): one of products.mjs PRODUCT_IDS.
                                        // Omit ⇒ the project/customer defaultProduct, else the product
                                        // the resolved TERRITORIES make it. Unknown ⇒ clarify — never a
                                        // silent substitute. The product decides case law and the name
                                        // count; neither is a field a request may set.
  // nativeLanguage: true,              // OPTIONAL, and only on a Multi-country focus search: the
                                        // native-language investigation. It is AUTOMATIC on a Full
                                        // country search and not offered elsewhere — asking for it there
                                        // clarifies rather than being recorded and ignored.
  // recipeKey: "quarterly-screen",     // OPTIONAL alternative selector: a customer's SAVED search (its
                                        // base product + component toggles). Mutually exclusive with
                                        // product. Always honored (the switch that could shut this door
                                        // was retired 2026-07-27).
  // deliveryRoute: "portal",           // OPTIONAL: "email" (default) or "portal" — a portal-route packet
                                        // is mark_sent by the courier WITHOUT an email send.
  // parentRunId: "novapulse-cedar",    // OPTIONAL escalation lineage: the run this one escalates from
                                        // (e.g. a knockout HIGH mark → this prelim). Recorded, not yet resolved.
  projectKey: "console-ecosystem",      // spec 62 (OPTIONAL): the PROJECT/engagement under the customer whose
                                        // overlay (its own marketplaces/classes/sector/posture) rates this
                                        // matter; omit ⇒ runs on the customer profile. Unknown key ⇒ clarify.
  customer: "Aurora Interactive",                // applicant/owner → affiliate self-exclusion set (§B3.2)
  customerUnknown: false,               // B5: true when the applicant is neither stated nor forwarder-implied —
                                        // arms candidate-self classification + the late-bind watch (NEVER inferred from the mark)
  // caseLaw — NOT A FIELD. The case-law and opposition reading is what a Full country search IS
  //                                    (product: "full-country-search"), and sending it clarifies rather
  //                                    than being accepted and dropped. The stage still SELF-triggers
  //                                    when the draft narrative turns on a precedent or an opposition;
  //                                    that arm was never a request and is untouched.
  deliverableSpec: "",                  // template/risk-framework/format asks, verbatim (§B3.6)
  commercialFlexibility: "",            // naming tier / cost-to-change — sets advice posture (§B3.7)
  priorUse: "",                         // stated prior/intended use; defaults per §B3.8 if empty
  campaignShape: "",                    // P2-C (Round-2 §8a): campaign-shape FACTS — how the mark will be
                                        // deployed (standalone brand vs flavour/sub-brand under a NAMED house
                                        // mark; seasonal/limited vs permanent line; launch scale), verbatim
                                        // from the request/client. Facts only, never inferred — absent, the
                                        // matter frame may only infer a shape with an explicit inference label.
  enqueuedAt: "2026-05-31T00:00:00Z",
};
