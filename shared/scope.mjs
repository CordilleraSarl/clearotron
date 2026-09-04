// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// shared/scope.mjs — the AUTHORIZATION plane for the MCP server (the inner gate).
//
// cf-access.mjs is the OUTER transport gate: "is this a cordillera person?" (CF Access JWT, per request).
// This module is the INNER gate: "WHAT may this principal do, on WHICH run?" Three principal kinds:
//   ops      — full: every read tool across all runs + the write verbs (start_run/stop_run/feed_context)
//              + what-if (stdio only). Minted for clawdi/ops, and used unconditionally on the trusted
//              local stdio surface.
//   user     — read-only, bound to EXACTLY ONE delivered run; cannot enumerate or read other runs and
//              cannot call any write/spend tool. This is what a report's "Ask your AI" link mints.
//   internal — a CF-authed cordillera person with NO inner token: read-only across ALL runs, no writes.
//              Preserves today's HTTP behaviour exactly (the 16 read tools, no what-if, no write verbs).
//
// The token is an HMAC-signed `v1.<base64url(payload)>.<base64url(sig)>` blob (payload {scope,runId,exp}).
// No external dep (node:crypto only) — so it imports + tests cleanly anywhere, including under the
// node_modules-less worktree. The signing secret is TRADEMARK_MCP_TOKEN_SECRET (fail-closed: mint/verify
// throw without it). enforcement is centralized in authorize(), called at the ONE CallTool dispatch chokepoint.

import { createHmac, timingSafeEqual, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { envFrom } from "./env-aliases.mjs";   // — resolves EITHER spelling; names the retired one because that is the live-writable half

const SECRET = () => process.env.TRADEMARK_MCP_TOKEN_SECRET || "";
// Rotation window: minting ALWAYS signs with the current secret; verification accepts current OR
// previous, so the HMAC secret rotates without a flag-day (set _PREVIOUS to the old value, deploy
// the new SECRET, drop _PREVIOUS once every outstanding token has expired).
const SECRETS = () => [process.env.TRADEMARK_MCP_TOKEN_SECRET, process.env.TRADEMARK_MCP_TOKEN_SECRET_PREVIOUS]
  .filter((s) => typeof s === "string" && s.length > 0);
const b64u = (buf) => Buffer.from(buf).toString("base64url");

// Emergency revocation: a plain-text denylist file (one `jti` per line, `#` comments), path in
// TRADEMARK_MCP_TOKEN_DENYLIST. Checked on every token verification. Short TTLs remain the primary
// control; a missing/unreadable file means "nothing revoked yet" (the denylist must never be able
// to take ALL token auth down on an fs blip). Legacy tokens carry no jti and are killed by secret
// rotation instead.
export function isRevoked(jti, { denylistPath = process.env.TRADEMARK_MCP_TOKEN_DENYLIST } = {}) {
  if (!jti || !denylistPath) return false;
  let text;
  try { text = readFileSync(denylistPath, "utf8"); } catch { return false; }
  return text.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#")).includes(jti);
}

/**
 * The recordable facts of a token THIS PROCESS just minted: `{ jti, exp, sub }` — never the token.
 *
 * NOT AN AUTHENTICATOR. This parses without verifying, which is safe for exactly one job: reading the
 * revocation handle out of our own `mintToken` output so `clearotron connect` can write it down
 * (, owner ruling: record key IDs, never secrets). Anything answering "is this token
 * good" goes through `verifyToken`; a caller handing this function a token from the WIRE is the defect.
 *
 * Returns null rather than throwing on a malformed string — the caller is recording, and a record of
 * "nothing recordable" is an absence it must handle, not a crash inside a mint that already succeeded.
 */
export function tokenId(token) {
  if (typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== "v1") return null;
  let payload;
  try { payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")); } catch { return null; }
  const jti = typeof payload?.jti === "string" && payload.jti ? payload.jti : null;
  if (!jti) return null;
  return { jti, exp: typeof payload.exp === "number" ? payload.exp : null,
    sub: typeof payload.sub === "string" && payload.sub ? payload.sub : null };
}

// Per-tool authorization facts (dictate-don't-infer — the registry declares; authorize() only reads it):
//   write      — mutates state or spends (ops only).
//   crossRun   — enumerates/searches across runs (forbidden to a run-bound user token).
//   clientSafe — the plain-language CLIENT layer: the ONLY tools a run-bound USER (report-link) token may
//                reach. Everything WITHOUT this flag (the engineering reads — trace, get_telemetry,
//                decision_timeline, get_coverage, diff_artifact, get_provider_usage, search, get_run,
//                get_finding, run_changes) is denied to a user token, so a report recipient cannot distil
//                the methodology / model tiers. read_artifact is clientSafe but additionally name-gated in
//                authorize() to USER_ARTIFACTS (the report) — internal artifacts stay sealed.
// Any tool absent here is treated as a run-scoped READ (the safe default for a new read tool).
//   accountSafe — the ACCOUNT layer: what a signed-in CLIENT may do across their OWN account's runs
//                (kind "account", see resolveScope). A superset of clientSafe in reach (many runs, not one)
//                but NOT in depth: it adds the run LIFECYCLE (list/plan/start/stop your own searches) and
//                nothing else. Every engineering read stays off it for the same reason it stays off
//                clientSafe — trace/get_telemetry/decision_timeline/get_run/search/audit narrate HOW the
//                work is done (reviewer lanes, stage order, model identity), which is the firm's method,
//                not the client's product. A tool absent here is denied to a client account, full stop.
//
// THE EVIDENCE LAYER (2026-07-22) draws that line one notch further out, for the ACCOUNT layer only.
// "Every engineering read stays off it" above was one rule doing two jobs, and it withheld more than it
// meant to: a client lawyer defending a filing decision needs the RECORDS behind the report (who owns
// what, in which classes, live or dead) and the SEARCHES that came back empty — and neither is method.
// The report narrates them; it does not enumerate them; nothing else could reach them.
//
// So the split is now stated as: EVIDENCE (what the search found and where it looked — facts about the
// world, mostly re-derivable from a public register) is client product; METHOD (how the work was ordered,
// gated, reviewed and produced) is the firm's. list_evidence / list_searches / get_search_coverage serve
// the first; every tool named in the paragraph above still serves the second and stays sealed.
//
// They are accountSafe and NOT clientSafe, deliberately: a report-link token rides in a delivered document
// and can be forwarded to anyone, while an account principal is a granted identity the firm enrolled.
// Widening the evidence layer to a forwardable link is a decision for whoever owns the client
// relationship, not a default. lib/evidence.mjs holds the projections and the reasoning behind them.
/**
 * HOW A CLIENT-REACHABLE TOOL'S RESULT IS PRESENTED.
 *
 * `presentForPrincipal` used to dispatch by tool NAME through an if-chain and fall through to
 * `return result`. So the safety of a new client-reachable read depended on someone remembering to add a
 * branch, and the default was ALLOW — while the function's own header said the opposite in as many
 * words: *"a new client-reachable read is scrubbed by default"*. The comment described the design; the
 * shape implemented the reverse.
 *
 * The disposition is declared here instead, beside the tool's other policy flags, and it is REQUIRED of
 * anything a client principal can reach. An undeclared one is REFUSED at the chokepoint rather than
 * returned raw — which is the default flip, and it is structural: a new tool cannot ship half-wired,
 * because there is nowhere for it to be half-wired.
 *
 *   scrub       the chokepoint transforms it — the branch lives in presentForPrincipal
 *   bounded     it projects named structured fields at the tool and forwards no free prose. The ONE
 *               documented exception (lib/scrub.mjs calls it that), declared per tool with its reason.
 *   project     the chokepoint projects it through lib/audit-view.mjs — an allowlist over the result's
 *               structure, with the surviving prose put through the report's own client-safety passes.
 *               DISTINCT FROM `bounded` on purpose: `bounded` asserts the TOOL already forwards no free
 *               prose, and the audit chain does forward prose — that is what the owner opened. Writing
 *               these four as `bounded` would have made that sentence false for three of the tools it
 *               governs, which is the kind of drift the disposition table exists to prevent.
 *   passthrough it is returned as-is. FLAGGED, not blessed: see the note on each.
 *
 * Every disposition below is the tool's EXISTING behaviour, written down. This change alters what a
 * client receives from nothing — it alters what happens to the next tool somebody adds.
 */
export const TOOL_SCOPES = {
  // / AGPL §13 — REACHABLE BY EVERY KIND OF SESSION, and that is the requirement rather than a
  // convenience. The offer is owed to whoever interacts with the service; a source offer that a client
  // token may not call is not an offer. It is run-agnostic, reads nothing about anybody, and returns
  // facts about published code — name, version, licence, repository and the commit this process runs.
  // NOT `crossRun`: that flag denies run-scoped user tokens, which are exactly the report recipients
  // §13 is written for.
  server_info: { clientSafe: true, accountSafe: true, present: "passthrough" },
  brief: { clientSafe: true, accountSafe: true, present: "scrub" },
  read_artifact: { clientSafe: true, accountSafe: true, present: "scrub" },
  list_findings: { clientSafe: true, accountSafe: true, present: "scrub" },
  // The evidence layer — run-scoped reads of the records, the searches and the coverage ledger. Named
  // get_search_coverage and NOT get_coverage on purpose: get_coverage is the engineering artifact-validity
  // view (which stage files exist, which validators passed) and stays internal.
  // `bounded`, with the reason: lib/evidence.mjs projects NAMED STRUCTURED FIELDS and enums derived from
  // them, and states in its header that there is no code path forwarding free prose. That is the one
  // documented exception in lib/scrub.mjs — declared per tool here rather than assumed, so it is a
  // decision a reader can find and disagree with.
  list_evidence: { accountSafe: true, present: "bounded" },
  list_searches: { accountSafe: true, present: "bounded" },
  get_search_coverage: { accountSafe: true, present: "bounded" },
  // ---- THE AUDIT CHAIN, accountSafe since the owner's 2026-08-27 ruling (see ACCOUNT_ARTIFACTS) -----
  // `project`, not `scrub`: these return STRUCTURED objects and `scrub` is a markdown transform that
  // would hand them straight back. lib/audit-view.mjs names the fields that travel and runs the prose
  // among them through the report's OWN client-safety passes — which is the one place this layer differs
  // from the evidence layer, deliberately: the ruling gives away the reasoning, and reasoning is prose.
  // That file's header holds the argument.
  get_run: { accountSafe: true, present: "project" },
  get_finding: { accountSafe: true, present: "project" },
  trace: { accountSafe: true, present: "project" },
  decision_timeline: { accountSafe: true, present: "project" },
  // ---- STILL SEALED, each for a stated reason ------------------------------------------------------
  // get_telemetry / get_provider_usage are the two tools that exist to report MODEL IDENTITY and BILLED
  // COUNTS — the firm's cost structure, which is not an audit fact. Every other decision-chain read is
  // model-free by construction (events.mjs, trace.mjs and getStages each say so on their own surface),
  // so sealing exactly these two costs the client nothing of the chain.
  get_telemetry: {}, get_provider_usage: {},
  // Not excluded by the ruling — unruled. get_coverage is the artifact-VALIDITY view (which stage files
  // exist, which validators passed); search sweeps every artifact's raw text including the sealed ones;
  // diff_artifact and run_changes compare internal snapshots. Each needs a decision about what it should
  // show a client, and this file's default is that an undecided tool is denied.
  get_coverage: {}, search: {},
  run_changes: {}, diff_artifact: {},
  list_runs: { crossRun: true, accountSafe: true, present: "scrub" }, search_runs: { crossRun: true },
  // list_profiles enumerates the firm's customer roster (not run-bound). Mark crossRun so it is allowed to
  // ops (clawdi/intake) + internal (CF-authed staff) but DENIED to a run-scoped user token (an external
  // report viewer must not enumerate the client list).
  list_profiles: { crossRun: true },
  // plan_run RESOLVES a prospective search and describes it: depth, effective scope, the account's caps.
  // A free read, so not `write` — but it reads account configuration, so crossRun (ops + internal, never
  // a run-scoped user token, which must not be able to enumerate or probe the firm's customers).
  //
  // `passthrough`, and FLAGGED rather than blessed: plan_run has no scrub pass at all. What a
  // client receives is bounded only by what the plan builder chooses to return. Whether it should be
  // scrubbed is a semantics question, raised on the issue rather than answered here.
  plan_run: { crossRun: true, accountSafe: true, present: "passthrough" },
  // describe_options enumerates the OPTION SPACE — the depths on offer, the three named bundles, the
  // scope rules, and the calling session's own account (its projects, its saved searches, what is left
  // of today's allowance). The portal hands a client all of this before they compose anything; an agent
  // driving the same product had five bare enum strings and had to guess, including the profileKey it is
  // REQUIRED to pass and cannot discover (list_profiles is staff-only, deliberately).
  //
  // Same posture as plan_run, and for the same reasons: free, so not `write`; it reads account
  // configuration, so crossRun (never a run-scoped report-link token, which must not be able to probe
  // the firm's customers); accountSafe, because answering "what may I order, and against which account"
  // is the client's own product, not the firm's method. What it does NOT do is enumerate the roster —
  // an account session is answered from ITS OWN grant, never from the customer list.
  // `passthrough`, flagged with plan_run — same posture, same open question.
  describe_options: { crossRun: true, accountSafe: true, present: "passthrough" },
  // ---- WHAT-IF, OPENED TO A CLIENT ACCOUNT (owner ruling 2026-08-27) -------------------------------
  //
  // `write: true` stays on BOTH, and on what_if_plan that is deliberate rather than inherited. The flag's
  // stated meaning is "mutates state or spends", and a plan does neither — but the ONLY thing that reads
  // it besides this gate is the ops verb allowlist (`if (rule.write && scope.verbs …`), so clearing it
  // would silently let every verb-scoped ops token call a tool its allowlist excludes. Re-labelling it is
  // a decision about ops least-privilege, not about this ruling, and it is not taken here.
  //
  // The account branch does not consult `write` at all — `accountSafe` is its gate — so a client reaches
  // both. What a client reaches is not what an ops token reaches, though: over the client connector
  // what_if_run ENQUEUES (server.mjs branches on scope.kind) and never spawns the engine, because the
  // remote surfaces' "NEVER shells" property is a fact about the code and has to stay one.
  //
  // `project`: both carry what the audit-chain ruling sealed. The plan resolves a MODEL and prints the
  // prior run's TOKEN COUNTS as its cost prior; lib/audit-view.mjs keeps the wall time and the honesty
  // note and drops the other two. The enqueue acknowledgement is projected for the same reason every
  // client-reachable result is — so a field added to it later cannot arrive unruled.
  what_if_plan: { write: true, accountSafe: true, present: "project" },
  what_if_run: { write: true, accountSafe: true, present: "project" },
  // A pure read of a queued experiment's state, addressed by its run — so the dispatch chokepoint's
  // account gate covers it. Not `write`: it settles nothing and spends nothing.
  what_if_result: { accountSafe: true, present: "project" },
  // `passthrough`, flagged: both answer a client and neither is scrubbed. Their results are
  // acknowledgements rather than reads, which is why this is probably right — but "probably" is the
  // reason it is declared and raised rather than left to a fall-through.
  start_run: { write: true, crossRun: true, accountSafe: true, present: "passthrough" },
  stop_run: { write: true, accountSafe: true, present: "passthrough" },
  feed_context: { write: true },
  mark_sent: { write: true }, ack_event: { write: true },
  // The integrator delivery reads: cross-run discovery + the send payload (recipient routing + full
  // email body) — ops/internal only, never a client (user) token.
  list_outbox_events: { crossRun: true }, get_delivery_packet: {},
};

// The ONLY artifact a user (report-link) token may read via read_artifact — THE report (one report;
// clientSummary was a second version by another name and is retired from client reach — the file
// remains an internal cover-note source ops tokens may read). Everything else
// (narrative, audit, run.jsonl, skepticFlags, lisaEyeReview, matterContext, caseLaw, register axes,
// status.json, …) is internal and stays sealed from a user token.
// Exported so the server's Resources surface (ListResources/ReadResource) gates to the SAME set.
export const USER_ARTIFACTS = new Set(["report"]);

// ---- THE AUDIT CHAIN, OPENED TO A CLIENT ACCOUNT (owner ruling 2026-08-27) -----------------------
//
// "I don't see why we don't open it or just give it to clients. Ignore the call spend." That ruling
// widens the line the TOOL_SCOPES header draws above — the one that read "every engineering read stays
// off it… A tool absent here is denied to a client account, full stop." It is now narrower than that.
//
// WHAT MOVED, AND THE LINE THAT REPLACED IT. The old line was EVIDENCE vs METHOD: what the search found
// is the client's, how the work was ordered and reviewed is the firm's. The ruling gives away the second
// half of that — the decision chain — and keeps a smaller thing:
//
//   OPEN    the audit chain: the audit trail itself, the reasoning narrative, the record artifacts, the
//           stage-by-stage decision walk, the verdict history. A lawyer defending a filing decision has
//           to be able to show HOW the answer was reached, and the owner ruled that is theirs.
//   SEALED  MODEL IDENTITY, BILLED COUNTS, and THE ENGINE'S JUDGMENT OF ITS OWN OUTPUT. Which model tier
//           ran a stage and what it cost is the firm's cost structure, not an audit fact — and
//           `withdrawn_reason` ("confabulated attribution") is an assessment of our own quality that the
//           client has no counterpart for, already ruled un-forwardable (, scrub.mjs).
//
// That line is cheap to hold because the code had already drawn it: events.mjs says "Model identity is
// deliberately NOT projected here: decision_timeline / run_changes are narrative surfaces", trace.mjs and
// server.mjs's getStages say the same of trace and get_run. So the three decision-chain reads carry no
// model identity BY CONSTRUCTION, and the sealed set is exactly the two tools that exist to report cost:
// get_telemetry and get_provider_usage. get_coverage, search, diff_artifact and run_changes stay sealed
// too — not because the ruling excludes them, but because nobody has ruled what they should show a
// client, and this file's own default is that an unruled tool is denied.
//
// FORKED FROM THE REPORT-LINK TOKEN, DELIBERATELY. USER_ARTIFACTS gates read_artifact for BOTH client
// kinds, so widening it in place would have opened the audit chain to a `user` token as well — a
// forwardable link riding inside a delivered PDF, which this file already says is "a decision for
// whoever owns the client relationship, not a default". The owner ruled on CLIENTS; a report recipient
// is a different audience. So the account layer gets its own set and the report link is untouched.
//
// ALLOWLIST, and the reason it is not "everything except". paths() declares ~90 artifact keys, most of
// them `_driver/` machine state nobody has ever weighed for a client audience. A new one added upstream
// is withheld here by default rather than served until someone notices.
//
//   report            the delivered report (the report-link set too)
//   audit             THE audit trail — the count-guaranteed decision record. This is the ruling's subject.
//   narrative         the reasoning write-up the verdict was taken against
//   registerFindings  the register digest: what the register search found, ruled
//   commonLaw         the common-law findings, likewise
//   caseLaw           court decisions considered — facts about the world, the evidence class exactly
//   matterContext     the matter as the run understood it — the client's own instruction, read back
//   registerUnit:<axis> / <axis>   the per-axis register output the digest was built from
//
// WITHHELD, each for a reason a reader can disagree with:
//   status.json, run.jsonl  JSON, and the scrub is a MARKDOWN transform — it would pass them through
//                     untouched. They also carry the run codename, the agent id, absolute paths and (on
//                     a failure) the engine's raw stack. get_run projects the same lifecycle facts
//                     through a bounded view, which is the honest way to serve them.
//   skepticFlags, seniorEyeReview  the reviewers' judgment of the ENGINE'S OWN output. Same class as
//                     `withdrawn_reason` and the same ruling: the client has no counterpart for it. The
//                     verdict those reviews produced is NOT withheld — trace and decision_timeline carry
//                     it — only the internal critique that reached it.
//   clientSummary     ops-only, stated in the issue: one report, and the cover-note source is not it.
//   everything else   absent, therefore denied.
export const ACCOUNT_ARTIFACTS = new Set([
  "report", "audit", "narrative", "registerFindings", "commonLaw", "caseLaw", "matterContext",
]);

// A register axis has to be named with its PREFIX here — `registerUnit:primary-sweep`, not the bare
// `primary-sweep` that read_artifact also accepts from staff. The axis vocabulary is the driver's and
// this module deliberately imports nothing from the driver (see the header: node:crypto only, so it
// loads under a node_modules-less worktree), so an unprefixed axis could only be matched by SHAPE — and
// a lowercase-hyphenated shape is also what `placement`, `findings` and half the sealed artifact keys
// look like. Requiring the prefix is what keeps this an allowlist instead of a pattern that happens to
// exclude the names somebody thought of. The axis itself is resolved downstream against the real
// REGISTER_AXES list, which is what refuses "registerUnit:../../x" — this decides the class of name only.
const AXIS_PREFIXED = /^register-?[Uu]nit:[a-z][a-z0-9-]{2,40}$/;

/** True when a client account may read this artifact by name. */
export function accountMayReadArtifact(name) {
  const n = String(name ?? "");
  return ACCOUNT_ARTIFACTS.has(n) || AXIS_PREFIXED.test(n);
}

// The raw list_findings views an ACCOUNT may reach — the three block lists audit.md carries. `audit` is
// the one the ruling is about (the Audit Trail section); `findings` and `negatives` come with it because
// they are the same document's other two sections and withholding them would serve a chain with its
// conclusions cut out. A report-link token reaches NONE of these: USER_FINDING_GROUPS still binds it to
// the curated cards, unchanged.
export const ACCOUNT_FINDING_KINDS = new Set(["findings", "negatives", "audit"]);

// The ONLY list_findings views a user (report-link) token may reach: the curated report-card groups (the
// plain-language client cards). The raw kind path (findings/negatives/AUDIT) parses audit.md — the sealed
// audit trail carrying the run's search queries, step rationales and register/common-law PROVIDER names — the
// internal methodology a report recipient must not distil (see the TOOL_SCOPES comment + the read_artifact
// seal to USER_ARTIFACTS). Enforced in authorize() so the gate stays at the one chokepoint.
export const USER_FINDING_GROUPS = new Set(["on-field", "off-field", "out-of-scope"]);

// ---- GRANTS: the tenant→accounts guest list (INSTALL.md §8) ---------------------------------------
// One JSON file (CLEAROTRON_ACCESS_FILE): { tenants: { <t>: { accounts: "*"|[keys], users: { <email|*@domain>:
// "*"|[keys] } } } }. File UNSET ⇒ enforcement OFF (single-tenant trust, today's behavior — every scope
// gets accounts:"*"). File SET but unreadable/malformed ⇒ THROW (a configured guest list must never fail
// open). Account keys are the profileKey values a run freezes into _driver/profile.json.
export function loadGrants({ grantsPath = envFrom(process.env, "CLEAROTRON_ACCESS_FILE") } = {}) {
  if (!grantsPath) return null;
  const g = JSON.parse(readFileSync(grantsPath, "utf8"));
  if (!g || typeof g.tenants !== "object" || Array.isArray(g.tenants)) throw new Error("grants file malformed — no tenants object");
  assertGrantsShape(g, grantsPath);
  return g;
}

// ── — THIS IS THE FILE AN OPERATOR WRITES BY HAND ──────────────────────────
//
// `clearotron start` creates it empty and enrolling anyone means writing this shape, so the person who
// gets a malformed one is the person least equipped to read a stack trace. Before this, an object where
// the code wants an array of account keys reached `accountsForEmail` and threw
// `TypeError: (eff ?? []) is not iterable` — naming a variable that appears nowhere in the file they just
// edited, from a door that answers it as a 500 rather than as a refusal.
//
// It is checked HERE, at the read, because that is the operator's moment: the failure belongs where they
// can still fix it, not on the next client's request. The message names the path INTO the file, what was
// found, and what the shape is — a reader has to be able to go straight to the line.
//
// Note the two legal shapes and that "*" is one of them: `accounts` is "*" or an array of keys, and a
// user maps to "*" (the tenant's whole grant) or an array. Anything else is refused rather than coerced,
// for the reason the file's own header gives — a configured guest list must never fail open.
export function assertGrantsShape(g, where) {
  const at = (...parts) => `${where}: tenants.${parts.join(".")}`;
  const keys = (v) => Array.isArray(v) && v.every((k) => typeof k === "string");
  for (const [tenant, t] of Object.entries(g.tenants ?? {})) {
    if (!t || typeof t !== "object" || Array.isArray(t)) {
      throw new Error(`${at(tenant)} is ${describe(t)} — each tenant must be an object with "accounts" and "users".`);
    }
    if (t.accounts !== undefined && t.accounts !== "*" && !keys(t.accounts)) {
      throw new Error(`${at(tenant, "accounts")} is ${describe(t.accounts)} — it must be "*" or an array of account keys, `
        + `for example ["${tenant}"].`);
    }
    if (t.users !== undefined && (!t.users || typeof t.users !== "object" || Array.isArray(t.users))) {
      throw new Error(`${at(tenant, "users")} is ${describe(t.users)} — it must be an object mapping each email `
        + `(or "*@domain") to "*" or an array of account keys.`);
    }
    for (const [pat, acc] of Object.entries(t.users ?? {})) {
      if (acc !== "*" && !keys(acc)) {
        throw new Error(`${at(tenant, "users", JSON.stringify(pat))} is ${describe(acc)} — it must be "*" `
          + `(the tenant's whole grant) or an array of account keys, for example ["${tenant}"].`);
      }
    }
  }
}

// What a reader sees, in the words of the file they wrote — "an object", not "[object Object]". The
// commonest wrong shape by far is an object where an array belongs, and it is the one a bare type name
// leaves ambiguous, so it names its own keys.
function describe(v) {
  if (v === null) return "null";
  if (Array.isArray(v)) return "an array with a non-string entry";
  if (typeof v === "object") return `an object (keys: ${Object.keys(v).slice(0, 4).map((k) => JSON.stringify(k)).join(", ") || "none"})`;
  return `${typeof v} ${JSON.stringify(v)}`;
}

// Resolve an authenticated email's granted accounts: "*" (everything), [keys], or [] (authenticated but
// granted nothing). A user entry of "*" means "the tenant's whole grant"; a `*@domain` key matches every
// email on that domain; an email in several tenants gets the union.
export function accountsForEmail(email, grants) {
  if (!grants) return "*";
  const e = String(email ?? "").toLowerCase();
  const domain = e.includes("@") ? e.split("@")[1] : "";
  let all = false;
  const set = new Set();
  for (const t of Object.values(grants.tenants ?? {})) {
    for (const [pat, acc] of Object.entries(t.users ?? {})) {
      const p = String(pat).toLowerCase();
      if (p !== e && !(p.startsWith("*@") && domain && p.slice(2) === domain)) continue;
      const eff = acc === "*" ? t.accounts : acc;
      if (eff === "*") { all = true; continue; }
      // — refuse by name, never by TypeError. `loadGrants` checks this shape at
      // the read, which is where an operator can still fix it, but grants also arrive here from callers
      // that never went through it (an injected fixture, a store read elsewhere), so the resolver states
      // the same fault rather than iterating whatever it was handed.
      if (eff !== undefined && eff !== null && !Array.isArray(eff)) {
        throw new Error(`grants are malformed: the entry for "${pat}" resolves to ${describe(eff)} — it must be "*" `
          + `or an array of account keys. Fix the grants file (CLEAROTRON_ACCESS_FILE) and try again.`);
      }
      for (const a of eff ?? []) set.add(a);
    }
  }
  return all ? "*" : [...set];
}

// The account gate. scope.accounts: null|"*" ⇒ full visibility (enforcement off / full grant); [keys] ⇒
// only those accounts. A run with NO account tag (pre-grants history) is visible only to full grants.
export function assertAccountAccess(scope, accountKey, what = "this run") {
  const acc = scope?.accounts;
  if (acc == null || acc === "*") return;
  if (!Array.isArray(acc)) throw new Error("malformed scope.accounts");
  if (accountKey == null) throw new Error(`${what} carries no account tag — visible only to full-grant sessions`);
  if (!acc.includes(accountKey)) throw new Error(`your grant does not include account "${accountKey}"`);
}
export function accountVisible(scope, accountKey) {
  try { assertAccountAccess(scope, accountKey); return true; } catch { return false; }
}

// Ops-token issuance (INSTALL.md §8): `sub` names the PRINCIPAL the token was minted
// for (an integrator connector, an operator) and rides into the audit log; `verbs` (ops-only) is an
// optional least-privilege allowlist of WRITE tools — an intake-only connector carries
// verbs:["start_run","feed_context"] and physically cannot stop_run. `accounts` (ops-only, GRANTS) caps
// the token to a set of account keys. All absent on legacy tokens, which verify and behave as before.
// `account` (the API KEY) is a THIRD scope: a long-lived credential for a client agent that cannot do the
// browser sign-in Cloudflare Access requires (a fixed "API key" box in a connector's settings, a headless
// CLI). It names an identity in `sub` and NOTHING else that grants reach — the accounts it may see are read
// from the GRANTS FILE at request time (resolveScope below), never baked into the token, so deleting the
// grants row revokes the key's reach the moment the file is saved. `accounts` on an account token is a CAP
// (an intersection applied on top of the grant), never a source of authority.
export function mintToken({ scope, runId = null, ttlSec = 30 * 24 * 3600, sub = null, verbs = null, accounts = null, now = Date.now() }) {
  const secret = SECRET();
  if (!secret) throw new Error("TRADEMARK_MCP_TOKEN_SECRET unset — cannot mint a scoped token");
  if (scope !== "ops" && scope !== "user" && scope !== "account") throw new Error(`mintToken: scope must be ops|user|account (got "${scope}")`);
  if (scope === "user" && !runId) throw new Error("mintToken: a user token must be bound to a runId");
  // An account key is not run-bound and carries no identity of its own beyond `sub` — which is the whole
  // credential's meaning (whose key it is, which grants row it reads, what the audit log names). Minting one
  // without it would produce a key nobody can attribute or revoke by identity.
  if (scope === "account" && !sub) throw new Error("mintToken: an account token must name its identity in --sub (it resolves accounts through the grants file)");
  if (scope === "account" && runId) throw new Error("mintToken: an account token is not run-bound (drop --run)");
  if (verbs != null) {
    if (scope !== "ops") throw new Error("mintToken: verbs[] is only meaningful on an ops token");
    if (!Array.isArray(verbs) || !verbs.length || verbs.some((v) => typeof v !== "string"))
      throw new Error("mintToken: verbs must be a non-empty array of tool names");
    const writable = Object.keys(TOOL_SCOPES).filter((t) => TOOL_SCOPES[t].write);
    const unknown = verbs.filter((v) => !writable.includes(v));
    if (unknown.length) throw new Error(`mintToken: unknown write verb(s) ${unknown.join(", ")} (known: ${writable.join(", ")})`);
  }
  if (accounts != null) {
    if (scope !== "ops" && scope !== "account") throw new Error("mintToken: accounts[] is only meaningful on an ops or account token (a user token is already run-bound)");
    if (!Array.isArray(accounts) || !accounts.length || accounts.some((a) => typeof a !== "string" || !a))
      throw new Error("mintToken: accounts must be a non-empty array of account keys");
  }
  const payload = { scope, runId: scope === "user" ? String(runId) : null, exp: Math.floor(now / 1000) + Math.floor(ttlSec) };
  if (sub != null) payload.sub = String(sub);
  if (verbs != null) payload.verbs = verbs;
  if (accounts != null) payload.accounts = accounts;
  payload.jti = randomBytes(6).toString("hex"); // per-token id — the denylist revocation handle (item 4)
  const body = b64u(JSON.stringify(payload));
  const sig = b64u(createHmac("sha256", secret).update(body).digest());
  return `v1.${body}.${sig}`;
}

export function verifyToken(token, { now = Date.now() } = {}) {
  const secrets = SECRETS();
  if (!SECRET()) throw new Error("TRADEMARK_MCP_TOKEN_SECRET unset — cannot verify a scoped token");
  if (typeof token !== "string") throw new Error("token must be a string");
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== "v1") throw new Error("malformed token");
  const [, body, sig] = parts;
  // Rotation window (item 5): the signature must match the CURRENT secret or, during a rotation,
  // the PREVIOUS one. Each candidate is compared timing-safely.
  const a = Buffer.from(sig);
  const matched = secrets.some((secret) => {
    const b = Buffer.from(b64u(createHmac("sha256", secret).update(body).digest()));
    return a.length === b.length && timingSafeEqual(a, b);
  });
  if (!matched) throw new Error("bad token signature");
  let payload;
  try { payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")); } catch { throw new Error("token payload not JSON"); }
  if (!payload || (payload.scope !== "ops" && payload.scope !== "user" && payload.scope !== "account")) throw new Error("token scope invalid");
  if (payload.scope === "user" && !payload.runId) throw new Error("user token missing runId binding");
  if (payload.scope === "account" && !(typeof payload.sub === "string" && payload.sub)) throw new Error("account token missing its sub identity");
  if (typeof payload.exp !== "number" || payload.exp <= Math.floor(now / 1000)) throw new Error("token expired");
  const jti = typeof payload.jti === "string" && payload.jti ? payload.jti : null;
  if (isRevoked(jti)) throw new Error("token revoked (jti is on the denylist)");
  const sub = typeof payload.sub === "string" && payload.sub ? payload.sub : null;
  const verbs = Array.isArray(payload.verbs) && payload.verbs.every((v) => typeof v === "string") && payload.verbs.length
    ? payload.verbs : null;
  const accounts = Array.isArray(payload.accounts) && payload.accounts.every((a) => typeof a === "string") && payload.accounts.length
    ? payload.accounts : null;
  return { scope: payload.scope, runId: payload.runId ?? null, exp: payload.exp, sub, verbs, accounts, jti };
}

// The client principal's accounts, resolved from the GRANTS FILE — the one authority, shared by both ways
// of proving a client identity (a CF Access sign-in, or an account API key). Three fail-closed refusals,
// each of which has to stay: accountsForEmail answers "*" when NO grants file is configured and a missing
// guest list must never read as "every customer"; an empty grant is authenticated-but-entitled-to-nothing
// (403, not an empty read-all); and `cap` — an account token's optional accounts[] — can only NARROW the
// grant, so a key whose cap no longer intersects its identity's grant resolves to nothing and is refused
// rather than silently widening back to the full grant.
function grantedAccounts(identity, cap = null) {
  const granted = accountsForEmail(identity, loadGrants());
  if (!Array.isArray(granted))
    throw new Error("forbidden: client account access requires a configured grants file (refusing an unscoped wildcard)");
  if (granted.length === 0)
    throw new Error("forbidden: this identity is not granted any account");
  if (!Array.isArray(cap) || !cap.length) return granted;
  const narrowed = granted.filter((a) => cap.includes(a));
  if (!narrowed.length)
    throw new Error("forbidden: this key is capped to accounts its identity is no longer granted");
  return narrowed;
}

// True iff `email`'s domain (the part after the final '@') is one of firmDomains. PURE (no jose), so the HTTP
// handler can derive firm-staff-ness from the already-verified CF identity without pulling the auth lib. The
// `internal` (read-all) grant rests on THIS positive check — NOT on which CF app admitted the caller — so a
// customer email mistakenly admitted to the staff CF app still carries a non-firm domain and is refused.
// Matches cf-access.mjs domain semantics: exact match, lowercased, leading '@' stripped, empty set ⇒ false.
export function isFirmDomain(email, firmDomains = []) {
  if (typeof email !== "string") return false;
  const at = email.lastIndexOf("@");
  if (at < 0) return false;
  const domain = email.slice(at + 1).toLowerCase();
  const set = firmDomains.map((d) => String(d).toLowerCase().replace(/^@/, "")).filter(Boolean);
  return set.length > 0 && set.includes(domain);
}

// Resolve the effective scope for a session — POSITIVE and fail-closed. A principal reaches `internal`
// (read-all) ONLY by proving firm-staff identity (firmStaff, which the caller derives from the verified email
// domain via isFirmDomain). No token AND not firm staff ⇒ REFUSED — never a silent default to internal (the
// old default was the read-all-to-anyone bug). On the CLIENT MCP surface (clientSurface:true) the ONLY
// admissible principal is a run-bound `user` token; ops/internal are structurally impossible there, so a
// mis-scoped edge policy still cannot yield read-all to a customer. local=true (trusted stdio) ⇒ ops.
// With GRANTS on, an internal principal's "read-all" narrows to the email's granted accounts
// (accountsForEmail × CLEAROTRON_ACCESS_FILE); ops accounts come from the token claim (legacy token = "*" —
// first-party trust). Throws (surfaced as 401 for a bad token / 403 for a `forbidden:` refusal, and on an
// unreadable configured grants file — fail-closed) — never returns a fallback scope.
export function resolveScope({ local = false, innerToken = null, email = null, firmStaff = false, clientSurface = false,
  accountAccess = process.env.CLIENT_MCP_ACCOUNT_ACCESS === "1", now = Date.now() } = {}) {
  if (clientSurface) {
    // The customer-facing MCP face. TWO admissible principals, and nothing else:
    //
    //   • a run-bound `user` token — the report's "Ask your AI" link. One run, read-only. Unchanged.
    //   • an ACCOUNT principal — a CF-verified client identity with NO token, resolved to the accounts
    //     their email is granted (CLEAROTRON_ACCESS_FILE, the same guest list the portal's client door uses).
    //     This is what "connect your AI with your existing login" means: enrolment is the portal's, so
    //     there is no second credential to mint, rotate or revoke, and revoking portal access revokes this.
    //
    // An ops token is still NOT honoured here, and `internal` is still structurally unreachable.
    //
    // FAIL-CLOSED, three ways: the whole branch is off unless CLIENT_MCP_ACCOUNT_ACCESS=1 (so deploying
    // this code changes nothing by itself); accountsForEmail returns "*" when NO grants file is configured
    // and that wildcard is REFUSED here (a missing guest list must never mean "every customer"); and an
    // empty grant is refused too (authenticated but entitled to nothing ⇒ 403, not an empty read-all).
    if (!innerToken) {
      if (!accountAccess)
        throw new Error("forbidden: the client surface requires a run-scoped token (no read-all/internal access)");
      return { kind: "account", runId: null, sub: email ?? null, verbs: null, accounts: grantedAccounts(email) };
    }
    const t = verifyToken(innerToken, { now });
    // An ACCOUNT token — the API key. Same principal as the CF-signed-in client above, reached with a
    // credential instead of a browser login, so every downstream gate (the accountSafe tool set, the
    // per-account filters, the client scrub, runCaps) applies unchanged. The key proves WHO; the grants
    // file still decides WHAT — resolved here, on every session, never read from the token.
    if (t.scope === "account") {
      if (!accountAccess)
        throw new Error("forbidden: client account access is not enabled on this door");
      return { kind: "account", runId: null, sub: t.sub, verbs: null, accounts: grantedAccounts(t.sub, t.accounts) };
    }
    if (t.scope !== "user") throw new Error("forbidden: the client surface accepts only a run-scoped user token or an account key");
    return { kind: "user", runId: t.runId, sub: t.sub, verbs: null, accounts: null }; // run-bound — accounts moot
  }
  if (local) return { kind: "ops", runId: null, sub: "local", verbs: null, accounts: "*" };
  if (innerToken) {
    const t = verifyToken(innerToken, { now });
    // An account key belongs to the CLIENT door and nowhere else. Falling through would land it in the
    // `user` arm below with runId:null — a "run-bound" scope bound to no run, which every run-pinning check
    // downstream would then wave through. Refuse it here instead.
    if (t.scope === "account") throw new Error("forbidden: an account key is only accepted on the client surface");
    return t.scope === "ops"
      ? { kind: "ops", runId: null, sub: t.sub, verbs: t.verbs, accounts: t.accounts ?? "*" }
      : { kind: "user", runId: t.runId, sub: t.sub, verbs: null, accounts: null }; // run-bound — accounts moot
  }
  // `sub` carries the VERIFIED identity for every other principal (attribution, the audit log, the
  // forwarder stamp) and was the one arm that dropped it — a CF-authed staff member's email was known
  // here and thrown away, which is why a staff plan_run had no identity to stamp a forwarder from.
  if (firmStaff) return { kind: "internal", runId: null, sub: email ?? null, verbs: null, accounts: accountsForEmail(email, loadGrants()) };
  throw new Error("forbidden: no run-scoped token and not a firm-staff identity — refusing (internal read-all requires proven firm staff)");
}

// The ENFORCEMENT chokepoint. Returns the (possibly run-pinned) args to dispatch, or throws an Error the
// CallTool handler surfaces as an MCP error. ops ⇒ everything. user/internal ⇒ no write tools. user ⇒ also
// no cross-run tool, and every run-scoped call is PINNED to the token's bound run (a mismatching explicit
// runId is refused — it cannot reach another matter's confidential data).
// The requester/reply-routing stamp, for the principals that may choose their own.
//
// buildJob REQUIRES a forwarder ("…the requester/reply-routing key that rides the delivery packet
// (docs/DELIVERY.md)") and plan_run builds the same job start_run does, so a preview without one died on
// a message naming an internal doc — on the FREE call every connecting principal makes first. #53 fixed
// that for the account branch only; ops and internal hit the same wall. Fixed here rather than in
// buildJob because the answer is the SESSION's: who is asking is a fact of the verified identity.
//
// `args.forwarder ||` first: ops and internal are trusted principals routing on someone else's behalf (an
// intake connector forwards a client's request), so a caller-chosen value is legitimate and must win.
//
// `forwarder` is caller-choosable on EVERY branch, the account branch included (it reads
// `args.forwarder || scope.sub || "client-mcp"` — the same precedence). What the account branch forces is
// `forwarderEmail`, from the verified identity, and that is the field delivery actually routes on. Said
// precisely because the loose version of this sentence ("only the account branch overwrites") reads as an
// assurance that a client cannot choose its own forwarder — which is not true, and is the kind of
// assurance the next reader builds on. Forcing `forwarder` there too would be a behaviour change with its
// own test, not a comment.
//
// forwarderEmail is stamped ONLY from an email-shaped sub: an ops token's sub is often a connector name
// ("portal-poc") or "local", and writing `local@…` into a delivery packet is worse than leaving the field
// unset for the routing layer to resolve.
/**
 * The verified identity to ATTRIBUTE an action to, for a record that outlives the session.
 *
 * Never null, and that is the point rather than tidiness: `null` cannot say whether nobody was
 * identified or the field was never passed, and those want different answers — one is a session
 * question, the other is a caller bug. This returns the first; `driver/cancel.mjs` names the second.
 *
 * `sub` is the verified identity for every principal kind (see the note above `firmStaff`), so this
 * reads it exactly as `stampForwarder` does. Where there is no usable `sub` the KIND is still known
 * and is worth keeping — an unidentified `ops` session and an unidentified `account` one are different
 * investigations — so it rides along rather than being flattened to one word.
 */
export const UNIDENTIFIED = "unidentified";
export function attributionOf(scope, onBehalfOf = null) {
  const sub = typeof scope?.sub === "string" && scope.sub.trim() ? scope.sub.trim() : null;
  const kind = typeof scope?.kind === "string" && scope.kind.trim() ? scope.kind.trim() : null;
  const self = sub || (kind ? `${UNIDENTIFIED}:${kind}` : UNIDENTIFIED);

  // — THE DELEGATE, AND WHY IT IS NEVER RETURNED ALONE.
  //
  // The portal holds a verified human (a Cloudflare Access principal) and calls the engine with ONE ops
  // token whose `sub` is "portal". So the identity the MCP can prove is the machine, and the identity
  // the matter record needs is the person — and the only path between them is the portal asserting it.
  //
  // An asserted identity returned on its own would be indistinguishable from a proved one, in a file
  // that travels into an archived matter record. Any holder of that ops token could then write any name
  // into a client's record. So both are kept, in one identifier: who vouched, and for whom.
  //
  //     portal:someone@example.test    the portal, acting for a verified human
  //     portal                          the portal, naming nobody
  //
  // This is bookkeeping, not an access decision — nothing downstream reads `by` to grant anything, and
  // the delegate does not widen what the token may do.
  const delegate = typeof onBehalfOf === "string" && onBehalfOf.trim() ? onBehalfOf.trim() : null;
  if (!delegate) return self;
  // COUNTS AND IDENTIFIERS, NOT PROSE ('s scope note): this file is a matter record. A delegate
  // carrying whitespace, a colon or a newline would forge the compound form or spill a sentence into the
  // archive, so anything that is not a bare identifier is refused and the verified half stands alone.
  if (!/^[A-Za-z0-9._%+@-]{1,128}$/.test(delegate)) return self;
  return `${self}:${delegate}`;
}

function stampForwarder(scope, args) {
  const sub = typeof scope?.sub === "string" && scope.sub ? scope.sub : null;
  const out = { ...args, forwarder: args.forwarder || sub || "cordillera-mcp" };
  if (!out.forwarderEmail && sub?.includes("@")) out.forwarderEmail = sub;
  return out;
}

export function authorize(scope, toolName, args = {}) {
  const rule = TOOL_SCOPES[toolName] ?? {};
  const kind = scope?.kind ?? "internal";
  // describe_options' account gate, ABOVE the kind branches and keyed on the grant alone — the one
  // condition that means "this session is scoped to a set of accounts", whichever way it proved itself.
  //
  // Written once rather than per-branch because the per-branch shape is how this codebase has leaked
  // before: filterByAccounts narrows list_profiles for a grant-scoped INTERNAL session (a staff member
  // granted one customer), and a gate written only into the ops and account arms would let that same
  // session read another customer's name, projects, saved-search slugs and allowance from here — two
  // surfaces disagreeing about the same grant, which is exactly the search_runs object-shape bug.
  //
  // OMITTING profileKey stays legal for every kind: that is how a session asks "which accounts do I
  // hold", and it is the whole reason this tool exists (list_profiles is staff-only, and plan_run /
  // start_run REQUIRE the key it would have taught an account principal).
  if (toolName === "describe_options" && args?.profileKey && Array.isArray(scope?.accounts)
    && !scope.accounts.includes(String(args.profileKey)))
    throw new Error(`your grant [${scope.accounts.join(", ")}] does not include account "${args.profileKey}" — ${toolName} refused`);
  if (kind === "ops") {
    // Verb-scoped ops token (least privilege): reads stay unrestricted; WRITE verbs must be on the
    // token's allowlist. A legacy token (verbs absent) keeps full ops authority.
    if (rule.write && Array.isArray(scope?.verbs) && !scope.verbs.includes(toolName))
      throw new Error(`this ops token is verb-scoped to [${scope.verbs.join(", ")}] — "${toolName}" is not on it`);
    // GRANTS: an account-scoped principal may only START runs inside its grant. A job with no
    // profileKey runs under the neutral "generic" account — that too must be granted explicitly.
    if ((toolName === "start_run" || toolName === "plan_run") && Array.isArray(scope?.accounts)) {
      const key = args?.profileKey ?? "generic";
      if (!scope.accounts.includes(key))
        throw new Error(`your grant [${scope.accounts.join(", ")}] does not include account "${key}" — ${toolName} refused`);
    }
    // The PREVIEW only, deliberately — the same line the internal branch draws below.
    //
    // #53's defect was that the FREE call every principal makes first died on a message naming an
    // internal doc, so that is the call the stamp exists to rescue. Extending it to start_run would
    // quietly remove a spend gate: an ops token's sub is often a connector name or "local", buildJob
    // fills forwarderEmail from `${forwarder}@example.com` when none is given, and the result is a real
    // paid run whose delivery packet routes nowhere. A refusal naming the missing field is the cheaper
    // failure by far, and it is not the "accepted then quietly narrower" shape: the preview describes a
    // job stamped from the verified identity, and start_run says plainly which field to add.
    if (toolName === "plan_run") return stampForwarder(scope, args);
    return args;
  }
  // kind === "account": a signed-in CLIENT, across their OWN account(s). Reads the client layer on any of
  // their runs, and drives the run lifecycle for them. Run OWNERSHIP is not checked here — it is enforced
  // pre-dispatch by the account gate in server.mjs (assertAccountAccess on the resolved run) and by
  // filterByAccounts on enumeration, both of which key on scope.accounts being an Array.
  if (kind === "account") {
    if (!rule.accountSafe)
      throw new Error(`tool "${toolName}" is not available to a client account session`);
    // THE AUDIT CHAIN (owner ruling 2026-08-27) — the account layer reads it, the report-link token below
    // does not. Both gates were one line on USER_ARTIFACTS; they are two sets now, for the reason stated
    // at ACCOUNT_ARTIFACTS. The Resources surface in server.mjs gates on the SAME pair — two surfaces
    // disagreeing about one grant is the defect this file cites twice.
    if (toolName === "read_artifact" && !accountMayReadArtifact(args.name))
      throw new Error(`artifact "${args.name ?? "?"}" is not readable by a client account — readable: ${[...ACCOUNT_ARTIFACTS].join(", ")}, or a register axis as "registerUnit:<axis>"`);
    // The RAW audit path is open here and stays sealed to a report link. A group is still a group; a
    // kind (findings | negatives | audit) now resolves too, which is what "read the audit trail" means.
    if (toolName === "list_findings" && !args.group && !ACCOUNT_FINDING_KINDS.has(args.kind ?? "findings"))
      throw new Error(`list_findings: kind must be one of ${[...ACCOUNT_FINDING_KINDS].join(" | ")}, or pass a curated group (${[...USER_FINDING_GROUPS].join(" | ")})`);
    if (toolName === "list_findings" && args.group) {
      if (!USER_FINDING_GROUPS.has(args.group))
        throw new Error(`a client may only list findings by curated group (on-field | off-field | out-of-scope) — pass \`kind\` for the raw audit trail`);
      return { runId: args.runId, group: args.group };   // cards path: drop the raw-view args
    }
    // WHAT-IF (owner ruling 2026-08-27). Two rules, and each closes something the ruling did not open.
    //
    // A CLIENT DOES NOT PICK THE MODEL. `model` is both cost and method — the tier that runs a stage is
    // the firm's cost structure, sealed with get_telemetry above — and offering it on the one tool that
    // spends would let a client buy the top tier by naming it. The refusal names the field so an
    // assistant can drop it and re-plan rather than guessing which argument was unwelcome.
    if ((toolName === "what_if_plan" || toolName === "what_if_run") && args?.model != null)
      throw new Error(`what-if: "model" is not available to a client account — the model tier is chosen by the service. Express the change with "instructions".`);
    // AND THE RUN MUST BE DECLARED. what_if_run's only required argument is a confirmationToken, which is
    // plain base64url JSON that nothing signs (lib/whatif.mjs: "treated as UNTRUSTED input"). With no
    // `runId` in the args the account gate below — assertAccountAccess on authedArgs.runId — never fires,
    // and a hand-crafted token naming another customer's run would enqueue against it. Requiring the run
    // to be NAMED puts the grant check back in the path; whatIfEnqueue then proves the token agrees with
    // the name, so neither half can be satisfied alone.
    if (toolName === "what_if_run" && !args?.runId)
      throw new Error(`what_if_run: pass the runId of the run you planned against — a client session must name the run it is changing.`);
    if (toolName === "start_run" || toolName === "plan_run") {
      // The grant bounds which account a client may spend against. `generic` is the neutral profile a job
      // with no profileKey runs under, so it has to be granted explicitly like any other key — otherwise
      // omitting the field would be a way out of the grant.
      const key = args?.profileKey ?? "generic";
      if (!scope.accounts.includes(key))
        throw new Error(`your grant [${scope.accounts.join(", ")}] does not include account "${key}" — ${toolName} refused`);
    }
    if (toolName === "start_run" || toolName === "plan_run") {
      // WHO IS ASKING is server-stamped from the CF-verified identity, never caller-supplied. Both the
      // preview and the real thing get it, because both build the same job: plan_run reached buildJob
      // without a forwarder and died on "forwarder is required — the requester/reply-routing key that
      // rides the delivery packet (docs/DELIVERY.md)". A client's assistant cannot act on that — it names
      // an internal doc and a concept the client has no reason to know — and it broke the FREE preview,
      // the one call a client is most likely to make first.
      const stamped = { ...args, forwarder: args.forwarder || scope.sub || "client-mcp",
        forwarderEmail: scope.sub ?? args.forwarderEmail };
      // THE DAILY ALLOWANCE, and the reason this branch exists at all. runCaps.dailyRuns is enforced in
      // the runner ONLY for jobs stamped clientPrincipal:true, and that stamp is deliberately POSITIVE-ONLY
      // — absence means UNCAPPED (see checkRunCaps for why every inferred alternative fails dangerously).
      // Until now the portal was the only door that set it, so a run started over MCP would have been
      // uncapped: exactly the hole a demo tenant would find. Stamped HERE, at the chokepoint, so a client
      // cannot omit it or pass clientPrincipal:false to buy themselves an unlimited day.
      // plan_run does NOT carry it: it spends nothing, so stamping it would let a free preview burn a
      // day's allowance (the runner counts ledger rows, and a previewed job that never runs must not sit
      // in that count).
      return toolName === "start_run" ? { ...stamped, clientPrincipal: true } : stamped;
    }
    return args;
  }
  if (rule.write) throw new Error(`tool "${toolName}" requires an ops token — this is a read-only session`);
  // CF-authed, no inner token: read-all (today's behaviour). The stamp sits AFTER the write gate, so
  // start_run still refuses here — only the free preview is reached, and only to spare a staff member
  // inventing a routing key for a call that queues nothing.
  if (kind === "internal") return toolName === "plan_run" ? stampForwarder(scope, args) : args;
  // kind === "user": the report-link token — restricted to the plain-language CLIENT layer + ONE run.
  if (!rule.clientSafe)
    throw new Error(`tool "${toolName}" is not available to a client (user) token — client layer only`);
  if (toolName === "read_artifact" && !USER_ARTIFACTS.has(args.name))
    throw new Error(`a client token may only read the report (got "${args.name ?? "?"}")`);
  // list_findings is clientSafe ONLY via the curated report-card path (a valid group). The raw kind path
  // (findings/negatives/AUDIT) reads audit.md — the sealed audit trail (search queries, rationale, register/
  // common-law PROVIDER names) — which is internal-only and MUST NOT leak to a report recipient. Force the
  // cards path here and strip the raw-view args (kind/sourceLayer) so the handler cannot reach filterFindings.
  if (toolName === "list_findings" && !USER_FINDING_GROUPS.has(args.group))
    throw new Error(`a client token may only list findings by curated group (on-field | off-field | out-of-scope) — the raw audit trail is internal`);
  if (rule.crossRun) throw new Error(`tool "${toolName}" is not available to a run-scoped (user) token`);
  if (!scope.runId) throw new Error("user token has no run binding");
  if (args.runId != null && String(args.runId) !== String(scope.runId))
    throw new Error(`this token is scoped to run "${scope.runId}" and cannot access "${args.runId}"`);
  if (toolName === "list_findings")                 // cards path only: drop kind/sourceLayer, keep the group
    return { runId: scope.runId, group: args.group };
  return { ...args, runId: scope.runId };           // pin the bound run (inject when omitted)
}

// Which tool DEFS a session may even SEE (hygiene; authorize() is the real gate). ops+local = full incl
// what-if; ops over HTTP = reads + write verbs but NOT what-if (no remote shell/spend); internal = all read
// tools; user (report-link) = the plain-language client layer only (brief/list_findings/read_artifact);
// account = everything accountSafe, which since 2026-08-27 includes the audit chain and what-if.
//
// THE `local` TEST GOVERNS THE OPS BRANCH ONLY, and that is now load-bearing rather than incidental. An
// account session returns above it, so what-if is visible to a client — and what stops the client face
// shelling is not this listing but what_if_run's own shape: for an account it ENQUEUES (server.mjs) and
// the engine is spawned by driver/whatif-worker.mjs, in a service process, exactly as a clearance is.
export function visibleTools({ kind = "internal", local = false } = {}) {
  return (name) => {
    const rule = TOOL_SCOPES[name] ?? {};
    const isWhatIf = name === "what_if_plan" || name === "what_if_run";
    if (kind === "user") return !!rule.clientSafe;          // report-link token: plain client layer only
    if (kind === "account") return !!rule.accountSafe;      // signed-in client: client layer + own-run lifecycle
    if (kind !== "ops") return !rule.write;                 // internal (CF-authed staff): all read tools
    return isWhatIf ? local : true;                          // ops: all locally; over HTTP everything but what-if
  };
}
