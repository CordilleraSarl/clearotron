#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// trademark-artifacts-mcp — interrogate prelim trademark-clearance runs over MCP.
//
// One stdio binary, any number of consumers: an operator's own agent platform spawns it, and the user's
// own Claude spawns the SAME binary, as an account that can read the run-dirs.
//
// Most of the surface READS and nothing else — runs, artifacts, findings, trace, telemetry, usage,
// coverage, search. The ops tools are the exception and they WRITE: start_run, stop_run, feed_context,
// mark_sent and ack_event all route through ./lib/ops.mjs, and start_run enqueues a job that spends real
// money once the runner claims it. The only tool that SPAWNS THE ENGINE BINARY is what_if_run, sandboxed +
// gated via a confirmationToken handshake; the what-if module is imported LAZILY so the server starts
// without pulling exceljs/native addons. For a CLIENT ACCOUNT what_if_run does not spawn anything at all
//: it queues the experiment into the run dir and driver/whatif-worker.mjs runs
// it, which is how a client reaches the engine without a remote face ever shelling.
//
// Imports the prelim-driver read-only via ./lib/* — touches no driver/template/deploy file.

import "../shared/env-local.mjs";   // side effect: apply <repo>/.env when THIS file is the CLI entry (never on library import)
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListToolsRequestSchema, CallToolRequestSchema,
  ListResourcesRequestSchema, ReadResourceRequestSchema, ListResourceTemplatesRequestSchema,
  ListPromptsRequestSchema, GetPromptRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { existsSync, readFileSync } from "node:fs";
import { join, basename } from "node:path";
import { driverDir } from "../shared/driver-dir.mjs";   //
import { fileURLToPath } from "node:url";

import { enumerateRuns, resolveRun, runAccountKey } from "./lib/runs.mjs";
import { ORDERABLE_PRODUCTS } from "../driver/search-policy.mjs";
import { PRODUCTS } from "../driver/products.mjs";

// The offering writes its own schema prose. A hand-typed "up to 20 names" beside a wall that refuses at
// eight is the invitation/enforcement mismatch, said to a client's assistant.
const PRODUCT_DESC = `WHICH of the four searches. ${PRODUCTS.map((p) => `"${p.id}" — ${p.geography}; up to ${p.maxNames} name${p.maxNames === 1 ? "" : "s"}${p.caseLaw ? "; carries the case-law and opposition reading" : ""}${p.nativeLanguage === "offered" ? "; native language optional" : p.nativeLanguage === "automatic" ? "; native language automatic" : ""}`).join(". ")}. Omit it for the account's default, or for the search this request's own territories name. See describe_options.`;
import { loadFindings, getFinding, filterFindings, loadCards } from "./lib/findings.mjs";
import { buildBrief } from "./lib/brief.mjs";
import { providerUsage } from "./lib/usage.mjs";
import { coverage, artifactStatus } from "./lib/coverage.mjs";
import { trace } from "./lib/trace.mjs";
import { REGISTER_AXES, STAGE_ORDER, parseFront, parseSections, paths, compareCmd, loadProfiles, loadProjects } from "./lib/driver.mjs";
import { readCapped, mimeFor } from "./lib/util.mjs";
import { readEvents, projectTimeline } from "./lib/events.mjs";
import { tokenize, scoreLine } from "./lib/lexsearch.mjs";
import { artifactToStage, listArtifactVersions, assertDiffRefsSafe } from "./lib/artifacts.mjs";
import { authorize, visibleTools, USER_ARTIFACTS, ACCOUNT_ARTIFACTS, accountMayReadArtifact, assertAccountAccess, accountVisible, TOOL_SCOPES, readOnlyFor } from "./lib/scope.mjs";
// The AUDIT-CHAIN projections (owner ruling 2026-08-27). Imported eagerly: it pulls only scrub.mjs, which
// this file already loads, so there is nothing here for a lazy import to save.
import { accountRun, accountTrace, accountTimeline, accountFinding, accountFindingList,
  accountWhatIfPlan, accountWhatIfQueued, accountWhatIfResult, CLIENT_FAILURE_NOTE as clientFailureNote } from "./lib/audit-view.mjs";
import { scrubMarkdown, scrubBody, scrubFrontMatter, scrubCards } from "./lib/scrub.mjs";
import { evidenceRecords, searchLog, coverageStatement } from "./lib/evidence.mjs";
import { instructionsFor } from "./lib/instructions.mjs";
import { isEntrypoint } from "../shared/is-entrypoint.mjs";   // — one entry-point test, all spellings
import { BRAND } from "../shared/brand.mjs";   // — the operator name a client is told to expect, from the tenant seam
import { productIdentity } from "../shared/product-identity.mjs";   // AGPL §13 — one answer, three surfaces

const NS = "trademark-artifacts";
const log = (...a) => process.stderr.write(`[${NS}] ${a.join(" ")}\n`);

// Audience hint riding on the plain-layer tool outputs. NOT EVERY CLIENT FORWARDS MCP server-level
// `instructions` — one agent platform's runtime was verified reading only tools/capabilities/name — so
// the steer travels in the output itself and works on a client that ignores instructions entirely. Context-phrased, not imperative, so the MCP metadata
// injection-scrubber (which redacts "ignore previous instructions" patterns) leaves it intact.
const BRIEFING_NOTE =
  "Plain-language layer — brief the user in this voice. Translate any risk codes (e.g. 'Level 5 = C + " +
  "Horse Trade') into plain English. Model names and internal stage names belong in answers only when the " +
  "user explicitly asks how the system reached a conclusion.";

// ---- run / artifact helpers --------------------------------------------------------------------

function mustRun(runId) {
  const run = resolveRun(runId);
  if (!run) throw new Error(`run "${runId}" not found. Call list_runs to see available runIds/codenames.`);
  return run;
}

function artifactPath(run, name) {
  const { P, runDir } = run;
  if (name === "status.json") return join(runDir, "status.json");
  if (name === "run.jsonl" || name === "telemetry/run.jsonl") return driverDir(runDir, "run.jsonl");
  if (REGISTER_AXES.includes(name)) return P.registerUnit(name);
  // validate the axis against the known set — never let a "registerUnit:../../x" escape the run-dir
  if (name.startsWith("registerUnit:")) { const ax = name.split(":")[1]; return REGISTER_AXES.includes(ax) ? P.registerUnit(ax) : null; }
  if (name !== "runDir" && P[name] && typeof P[name] !== "function") return P[name];
  for (const [k, v] of Object.entries(P)) { if (k === "runDir" || typeof v === "function") continue; if (basename(v) === name) return v; }
  for (const ax of REGISTER_AXES) { if (basename(P.registerUnit(ax)) === name) return P.registerUnit(ax); }
  return null;
}

function listArtifacts(run) {
  const { P } = run; const out = [];
  for (const [k, v] of Object.entries(P)) { if (k === "runDir" || typeof v === "function") continue; if (existsSync(v)) out.push({ name: k, file: basename(v) }); }
  for (const ax of REGISTER_AXES) { const p = P.registerUnit(ax); if (existsSync(p)) out.push({ name: `registerUnit:${ax}`, file: basename(p) }); }
  if (existsSync(join(run.runDir, "status.json"))) out.push({ name: "status.json", file: "status.json" });
  if (existsSync(driverDir(run.runDir, "run.jsonl"))) out.push({ name: "run.jsonl", file: "_driver/run.jsonl" });
  return out;
}

// latest stage/skip event per stage label, ordered by STAGE_ORDER.
// Model identity is confined to get_telemetry — get_run is a narrative surface; failovers keep the fact only.
function getStages(runDir) {
  const events = readEvents(runDir);
  const byLabel = new Map();
  for (const e of events) if (e.event === "stage" || e.event === "skip") byLabel.set(e.stage, e);
  const failover = events.filter((e) => e.event === "failover").map((e) => ({ stage: e.stage, attempt: e.attempt ?? null }));
  const stages = [...byLabel.values()].map((e) => ({
    stage: e.stage, trigger: e.trigger, ok: e.ok ?? (e.event === "skip" ? true : null),
    attempts: e.attempts ?? null, fail: e.fail ?? null,
    // `output` is what LANDED (AD-4 made it unconditional, so a FAILED stage's row can carry a real file —
    // either its own mid-write or one inherited from an earlier pass). Projecting it alone let a failed
    // stage read on this surface — the one the babysit protocol polls — as having produced its artifact.
    // `outputWritten` is the discriminator that was already on the run.jsonl row and was simply not
    // forwarded: true = THIS dispatch emitted it, false = it was inherited, null = not observed. Absent
    // outputs now arrive as {present:false} (driver/log.mjs outputMeta) instead of a zero-size record.
    output: e.output ?? null, outputWritten: e.outputWritten ?? null, summary: e.summary ?? null,
    // — the stage's own wall boundaries. Forwarded EXPLICITLY, because this projection is a
    // whitelist and the comment above is the primary-source record of what happens when a new row field
    // is not added to it: `outputWritten` "was already on the run.jsonl row and was simply not forwarded".
    // `?? null` is the vintage discriminator, and it is the whole point — a run archived before
    // genuinely has no boundaries and must say so. `?? 0` would state that a stage took no time.
    dispatchedAt: e.dispatchedAt ?? null, settledAt: e.settledAt ?? null, wallSec: e.wallSec ?? null,
  }));
  stages.sort((a, b) => STAGE_ORDER.indexOf(String(a.stage).split(":")[0]) - STAGE_ORDER.indexOf(String(b.stage).split(":")[0]));
  return { stages, failover };
}

function runSummary(run) {
  const s = run.status ?? {};
  return {
    runId: run.runId, slug: run.slug, codename: run.codename, date: run.date, agent: run.agent,
    state: run.state, location: run.location, verdict: run.verdict, url: run.url,
    markName: run.markName, ref: run.ref, classes: run.classes,
    step: s.stepN ? `${s.stepN}/${s.stepTotal} ${s.stepLabel ?? ""}`.trim() : null,
    startedAt: run.startedAt, updatedAt: run.updatedAt, deliveredAt: run.deliveredAt,
    failedStage: run.failedStage, reason: run.reason,
    resetsAt: run.resetsAt ?? s.resetsAt ?? null,   // when state === "postponed": the cap-reset / auto-resume time
    recoveryResumesAt: run.recoveryResumesAt ?? s.recoveryResumesAt ?? null,   // when state === "recovering": the backoff clock (A4 split)
    parkedKind: run.parkedKind ?? s.parkedKind ?? null,     // when state === "parked-for-human": why (grace-exit)
    terminalKind: run.terminalKind ?? s.terminalKind ?? null,   // when state === "failed": why it ended (invalid-artifact-loop | reclaim-exhausted | …)
    // Handoff-mode delivery state (2026-07-10 fix): the driver has no gateway tools, so an agent turn sends
    // the packet and marks it here. This is the ONE place that state should be checked from. Previously this
    // summary omitted sendPending entirely, so callers fell back to guessing a run-dir path from prose and
    // scanning for a .sent file themselves — two independent guesses that could (and did) disagree.
    sendPending: s.sendPending === true,
    sent: existsSync(join(run.runDir, ".sent")),
    // B4 (per-channel receipts, 2026-07 duplicate-email fix): channel-level delivery state, dual-read.
    // A channel counts as sent when the run's _driver/send-receipts.json has that channel's receipt
    // (prelim-deliver writes one right after EACH send lands, before the final .sent) OR the legacy
    // all-channels .sent marker exists (pre-receipts runs wrote only that, after both sends). SKILL.md
    // step 2b reads this on a retry to skip already-receipted channels instead of re-emailing.
    channels: channelState(run.runDir),
  };
}

function channelState(runDir) {
  const legacySent = existsSync(join(runDir, ".sent"));
  let receipts = {};
  try { receipts = JSON.parse(readFileSync(driverDir(runDir, "send-receipts.json"), "utf8")) ?? {}; }
  catch { /* absent (fresh/legacy run) or unreadable — fall back to the .sent marker alone */ }
  const chan = (key, idField) => ({
    sent: Boolean(receipts[key]) || legacySent,
    messageId: receipts[key]?.[idField] ?? null,
    sentAt: receipts[key]?.sentAt ?? null,
  });
  return { email: chan("email", "emailMessageId"), whatsapp: chan("whatsapp", "whatsappMessageId") };
}

// ---- tool implementations ----------------------------------------------------------------------

const tools = {
  // / AGPL §13. One line, because the answer is not this file's to compose: shared/product-identity.mjs
  // is the single place all three network faces read, so the portal's About page, this tool and the CLI
  // cannot report three different running commits — which is the failure mode the module was built for.
  server_info() {
    return productIdentity();
  },
  brief({ runId }) {
    return { _note: BRIEFING_NOTE, ...buildBrief(mustRun(runId)) };
  },
  list_runs({ agent, state, slug, mark, sendPending, limit = 50 } = {}) {
    let out = enumerateRuns({ agent, state, slug, mark }).map(runSummary);
    if (sendPending === true || sendPending === false) out = out.filter((r) => r.sendPending === sendPending);
    return out.slice(0, limit);
  },
  list_profiles() {
    // Each customer carries its PROJECTS (engagements) so intake can resolve a projectKey too. A bad
    // project file must never blank the whole roster, so the project read is best-effort (its own loud failure
    // surfaces at run time via loadProjects in the driver).
    let byCustomer = new Map();
    try {
      for (const [fq, ov] of loadProjects()) {
        // An ARCHIVED project is not offered for new work: this list is what the intake AI resolves a
        // projectKey against, so a name it cannot see is a name it cannot pick. Already-queued and
        // finished runs are untouched — a run freezes its effective profile at admission.
        if (ov.archived) continue;
        const list = byCustomer.get(ov.customerKey) ?? [];
        list.push({ key: ov.projectKey, name: ov.projectName });
        byCustomer.set(ov.customerKey, list);
      }
    } catch { byCustomer = new Map(); }
    const clients = [...loadProfiles().values()]
      .filter((p) => p.key !== "generic")
      .map((p) => ({ key: p.key, name: p.name, industry: p.industry ?? null,
        projects: (byCustomer.get(p.key) ?? []).sort((a, b) => a.key.localeCompare(b.key)) }))
      .sort((a, b) => a.key.localeCompare(b.key));
    return {
      _note: "Customer roster for intake resolution. Resolve by JUDGMENT — an explicit name, a misspelling (\"Zefyr\"→zephyr), or an implicit reference (\"our functional-beverage client\") all map to a key. Set the job's profileKey to the chosen customer key; OMIT it for a new/unknown customer (⇒ the neutral generic profile). If the request names a specific PROJECT/engagement under that customer (listed in `projects[]`), also set projectKey to that project's key; OMIT projectKey when no project is meant (⇒ the customer profile). CLARIFY if you cannot tell either. Never pick a profile from the sender's email domain.",
      clients,
      genericFallback: "generic",
    };
  },
  async describe_options(args, extra) {
    const { describeOptions } = await import("./lib/options.mjs");
    return describeOptions(args, extra);
  },
  async plan_run(args, extra) {
    // Lazy import for the same reason start_run is: the read-only HTTP face should not pull the
    // enqueue machinery in just to describe a search.
    const { planRun } = await import("./lib/plan.mjs");
    return planRun(args, extra);
  },
  get_run({ runId }) {
    const run = mustRun(runId);
    const { stages, failover } = getStages(run.runDir);
    return {
      run: runSummary(run),
      stages, failover,
      artifacts: [...artifactStatus(run.P), ...REGISTER_AXES.map((ax) => {
        const p = run.P.registerUnit(ax); return { name: `registerUnit:${ax}`, file: basename(p), exists: existsSync(p) };
      })],
      coverageSummary: (() => { const c = coverage(run.P); return { complete: c.complete, coverageLedgerPresent: c.coverageLedgerPresent, findings: c.findings, negativeResults: c.negativeResults }; })(),
    };
  },
  read_artifact({ runId, name, section, frontMatterOnly }) {
    const run = mustRun(runId);
    const path = artifactPath(run, name);
    if (!path) throw new Error(`artifact "${name}" not recognized for ${runId}. Known: ${listArtifacts(run).map((a) => a.name).join(", ")}`);
    if (!existsSync(path)) return { name, file: basename(path), exists: false };
    const text = readCapped(path);
    const hint = name === "report" ? { _note: BRIEFING_NOTE } : {};   // one report — the plain-language layer
    if (frontMatterOnly) return { ...hint, name, frontMatter: parseFront(text).fm };
    if (section) { const secs = parseSections(parseFront(text).body); return { ...hint, name, section, text: secs[section] ?? `(section "${section}" not found; available: ${Object.keys(secs).join(", ")})` }; }
    return { ...hint, name, file: basename(path), text };
  },
  list_findings({ runId, kind, sourceLayer, group }) {
    const run = mustRun(runId);
    if (group) { const cards = loadCards(run.P); return { _note: BRIEFING_NOTE, kind: "cards", group, items: cards.cards.filter((c) => c.group === group), note: cards.note }; }
    return { _note: BRIEFING_NOTE, ...filterFindings(run.P, { kind, sourceLayer }) };
  },
  // ---- the evidence layer (accountSafe) --------------------------------------------------------
  // Data, not narrative: no BRIEFING_NOTE rides on these. The projections — and the reasoning about what
  // is evidence and what is method — live in lib/evidence.mjs; nothing is decided here.
  list_evidence({ runId, layer }) {
    const out = evidenceRecords(mustRun(runId));
    return layer ? { ...out, records: out.records.filter((r) => r.layer === layer) } : out;
  },
  list_searches({ runId, outcome }) {
    const out = searchLog(mustRun(runId));
    if (!outcome) return out;
    const searches = out.searches.filter((s) => s.outcome === outcome);
    return { ...out, count: searches.length, searches, totalCount: out.count };
  },
  get_search_coverage({ runId }) {
    return coverageStatement(mustRun(runId));
  },
  get_finding({ runId, id }) {
    const run = mustRun(runId);
    const f = getFinding(run.P, id);
    if (!f) throw new Error(`finding "${id}" not found in ${runId}. Use list_findings to see ids (F#, NR#, AT#).`);
    return f;
  },
  trace({ runId, target, depth, shallow }) {
    return trace(mustRun(runId), target, { depth: depth ?? 2, shallow: shallow === true });
  },
  get_telemetry({ runId, stage, axis }) {
    const run = mustRun(runId);
    const events = readEvents(run.runDir);
    const label = stage ? stage + (axis ? `:${axis}` : "") : null;
    let attempts = [];
    if (label) {
      try { attempts = readCapped(driverDir(run.runDir, `${label}.jsonl`)).trim().split("\n").map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); } catch { /* none */ }
    }
    return {
      runId, stage: label,
      runEvents: stage ? events.filter((e) => String(e.stage ?? "").split(":")[0] === stage || e.event === "verdict" || e.event === "failover") : events,
      attempts,
      providerUsage: events.find((e) => e.event === "provider-usage") ?? null,
    };
  },
  get_provider_usage({ runId }) {
    return providerUsage(mustRun(runId));
  },
  get_coverage({ runId }) {
    return coverage(mustRun(runId).P);
  },
  search({ runId, query, kind, mode = "all", limit = 60 }) {
    const run = mustRun(runId);
    if (!query) throw new Error("search: query is required");
    if (!["all", "any", "phrase"].includes(mode)) throw new Error(`search: mode must be one of all|any|phrase (got "${mode}")`);
    if (kind && !artifactPath(run, kind)) throw new Error(`search: artifact kind "${kind}" not recognized. Known: ${listArtifacts(run).map((a) => a.name).join(", ")}`);
    const tokens = tokenize(query), rawLower = query.toLowerCase();
    const names = kind ? [kind] : listArtifacts(run).map((a) => a.name);
    const hits = [];
    for (const name of names) {
      const path = artifactPath(run, name);
      if (!path || !existsSync(path)) continue;
      let text; try { text = readCapped(path); } catch { continue; }
      const lines = text.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const score = scoreLine(lines[i].toLowerCase(), tokens, mode, rawLower);
        if (score > 0) hits.push({ artifact: name, line: i + 1, score, snippet: lines[i].trim().slice(0, 240) });
      }
    }
    hits.sort((a, b) => b.score - a.score || a.artifact.localeCompare(b.artifact) || a.line - b.line);
    return { runId, query, mode, hits: hits.slice(0, limit), truncated: hits.length > limit };
  },
  decision_timeline({ runId }) {
    const run = mustRun(runId);
    const { timeline, verdictHistory } = projectTimeline(readEvents(run.runDir), run.P);
    // Honest: the risk ladder is only recoverable if the DIGEST itself has a prior snapshot;
    // a generic _history dir for some OTHER stage does not make register-findings diffable.
    const riskLadderAvailable = listArtifactVersions(run.P, run.runDir, "register-digest", null).length > 1;
    return {
      runId: run.runId, state: run.state, verdict: run.verdict, verdictHistory, timeline,
      riskLadderAvailable,
      note: riskLadderAvailable
        ? "A prior register-findings (digest) snapshot exists — diff_artifact can show the word-by-word change."
        : "Per-finding wording across digest versions isn't recoverable on this run: the escalation re-digest / corrective re-synthesis overwrite in place. Milestones + the changedFromPrevious SHA marker show where/when/why a document changed; the prior TEXT is gone.",
    };
  },
  run_changes({ runId, since, kinds }) {
    const run = mustRun(runId);
    // `since` is a stable seq cursor (number, from a prior call) OR an ISO timestamp (the first/human call).
    const sinceSeq = (typeof since === "number" || (typeof since === "string" && /^\d+$/.test(since.trim()))) ? Number(since) : null;
    const sinceTs = sinceSeq == null ? (since ?? null) : null;
    const { timeline } = projectTimeline(readEvents(run.runDir), run.P, { sinceTs, sinceSeq });
    const cursor = timeline.length ? timeline[timeline.length - 1].seq : (sinceSeq ?? null);
    let changes = timeline;
    if (Array.isArray(kinds) && kinds.length) changes = changes.filter((c) => kinds.includes(c.kind));
    return {
      runId: run.runId, state: run.state, verdict: run.verdict, since: since ?? null, cursor,
      count: changes.length, changes,
      note: "Poll again with since=cursor (a stable sequence number) for only newer events — MCP has no push. cursor is independent of the kinds filter.",
    };
  },
  diff_artifact({ runId, name, a, b, axis }) {
    const run = mustRun(runId);
    if (!name) throw new Error("diff_artifact: name is required");
    const map = artifactToStage(run.P, name);
    if (!map) throw new Error(`diff_artifact: artifact "${name}" not recognized. Try a stage output (registerFindings, narrative, report, …) or a register axis (e.g. primary-sweep).`);
    const stage = map.stage, resolvedAxis = axis ?? map.axis ?? null;
    if (stage === "register-unit") {
      if (!resolvedAxis) throw new Error(`diff_artifact: a register-unit needs an axis — pass axis (one of ${REGISTER_AXES.join(", ")}) or a fully-qualified name like "primary-sweep".`);
      if (!REGISTER_AXES.includes(resolvedAxis)) throw new Error(`diff_artifact: invalid axis "${resolvedAxis}". Known: ${REGISTER_AXES.join(", ")}.`);
    }
    const versions = listArtifactVersions(run.P, run.runDir, stage, resolvedAxis);
    assertDiffRefsSafe(versions, a, b); // reject a/b path-escape (absolute / ".." / cross-run) before compareCmd reads raw
    const r = compareCmd({ runDir: run.runDir, stage, axis: resolvedAxis, a, b });
    if (r.aRef === r.bRef) {
      return {
        runId: run.runId, name, stage, axis: resolvedAxis, a: r.aRef, b: r.bRef,
        identical: null, diff: null, snapshotsAvailable: versions,
        note: "Only one version of this artifact exists on disk (no _history snapshot or what-if experiment to compare). The driver overwrites in place on escalation/correction, so prior versions aren't kept unless something snapshotted one.",
      };
    }
    return {
      runId: run.runId, name, stage, axis: resolvedAxis, a: r.aRef, b: r.bRef,
      identical: !r.diff, diff: r.diff || "(identical)", telemetryDelta: r.table, snapshotsAvailable: versions,
    };
  },
  search_runs({ query, mode = "all", scope = "findings", agent, state, slug, maxRuns = 100, limit = 60 }) {
    if (!query) throw new Error("search_runs: query is required");
    if (!["all", "any", "phrase"].includes(mode)) throw new Error(`search_runs: mode must be one of all|any|phrase (got "${mode}")`);
    if (!["findings", "audit", "key-artifacts", "all-artifacts"].includes(scope)) throw new Error(`search_runs: scope must be findings|audit|key-artifacts|all-artifacts (got "${scope}")`);
    const tokens = tokenize(query), rawLower = query.toLowerCase();
    const runs = enumerateRuns({ agent, state, slug }).slice(0, maxRuns);
    const idy = (r) => ({ runId: r.runId, slug: r.slug, codename: r.codename, state: r.state, location: r.location, markName: r.markName });
    const hits = [];
    for (const r of runs) {
      const run = { ...r, P: paths(r.runDir) };
      if (scope === "findings") {
        let f; try { f = loadFindings(run.P); } catch { continue; }
        const rows = [
          ...f.findings.map((x) => ({ where: "finding", id: x.id, text: [x._title, x.owner, x.search_terms, x.status, x.classes].filter(Boolean).join(" | ") })),
          ...f.negatives.map((x) => ({ where: "negative", id: x.id, text: [x.search_term, x.platform, x.result].filter(Boolean).join(" | ") })),
          ...f.audit.map((x) => ({ where: "audit", id: x.id, text: [x.query, x.rationale, x.finding_ref, x.result_summary].filter(Boolean).join(" | ") })),
        ];
        for (const row of rows) {
          const score = scoreLine(row.text.toLowerCase(), tokens, mode, rawLower);
          if (score > 0) hits.push({ ...idy(r), where: row.where, id: row.id, score, snippet: row.text.slice(0, 240) });
        }
      } else {
        const names = scope === "audit" ? ["audit"]
          : scope === "key-artifacts" ? ["report", "registerFindings", "commonLaw", "narrative"]
          : listArtifacts(run).map((x) => x.name);
        for (const name of names) {
          const path = artifactPath(run, name);
          if (!path || !existsSync(path)) continue;
          let text; try { text = readCapped(path); } catch { continue; }
          const lines = text.split("\n");
          for (let i = 0; i < lines.length; i++) {
            const score = scoreLine(lines[i].toLowerCase(), tokens, mode, rawLower);
            if (score > 0) hits.push({ ...idy(r), artifact: name, line: i + 1, score, snippet: lines[i].trim().slice(0, 240) });
          }
        }
      }
    }
    hits.sort((a, b) => b.score - a.score || String(a.runId).localeCompare(String(b.runId)));
    return { query, mode, scope, runsScanned: runs.length, hits: hits.slice(0, limit), truncated: hits.length > limit };
  },
  async what_if_plan({ runId, stage, axis, instructions, model, kind }) {
    const run = mustRun(runId);
    const { whatIfPlan } = await import("./lib/whatif.mjs");
    // `kind` DEFAULTS TO "stage", so every existing caller is unchanged. A memo is the other kind
    // (tracker issue 132): a bounded re-read of a DELIVERED run's archived evidence under a stated
    // assumption, which re-runs no stage and therefore cannot carry one.
    const asked = kind === "memo" ? "memo" : "stage";
    // A STAGE PLAN WITH NO STAGE IS A REFUSAL, NOT A THROW. `stage` cannot be schema-required any more:
    // it is required for one kind and meaningless for the other, and JSON Schema's `required` cannot say
    // that. So the check moves here, and it answers in the shape the caller can read — the alternative
    // was whatIfPlan throwing `unknown stage "undefined"`, which names the symptom and not the fix.
    if (asked === "stage" && !stage) {
      return { runnable: false, reason: "what_if_plan needs a `stage` to re-run. For a supplementary memo over "
        + "a delivered report's archived evidence — no searching, no spend — pass `kind: \"memo\"` and put the "
        + "assumption in `instructions` instead." };
    }
    return whatIfPlan({ run, stage, axis, instructions, model, kind: asked });
  },
  // TWO PATHS, AND WHICH ONE RUNS IS A FACT ABOUT THE PRINCIPAL.
  //
  // ops/stdio EXECUTES: whatIfRun shells the engine, which is why what-if has always been local-only.
  // A client ACCOUNT ENQUEUES: it never reaches whatIfRun, so the remote surfaces' "NEVER shells"
  // property (http-server.mjs's header) stays a fact about what the code can do rather than a habit.
  // The branch is on scope.kind rather than on a flag, because that is the thing that differs.
  async what_if_run({ confirmationToken, runId }, extra = {}) {
    const scope = extra.scope ?? {};
    if (scope.kind === "account") {
      const { whatIfEnqueue } = await import("./lib/whatif.mjs");
      return whatIfEnqueue({ run: mustRun(runId), confirmationToken, requestedBy: scope.sub ?? null,
        account: Array.isArray(scope.accounts) ? scope.accounts.join(",") : null });
    }
    const { whatIfRun } = await import("./lib/whatif.mjs");
    return whatIfRun({ confirmationToken });
  },
  // The result of a queued what-if, addressed by the RUN it belongs to — so the dispatch chokepoint's
  // account gate covers this read with no second gate of its own. Omit experimentId to list this run's.
  async what_if_result({ runId, experimentId }) {
    const run = mustRun(runId);
    const { readWhatIf, listWhatIf } = await import("../driver/whatif-queue.mjs");
    if (!experimentId) return { runId, experiments: listWhatIf(run.runDir) };
    return { runId, ...readWhatIf(run.runDir, experimentId) };
  },
  // ---- OPS write-face (ops token / stdio only; gated in scope.authorize). Lazy-imported so the read-only
  //      HTTP path never loads the enqueue/queue machinery. The dispatch threads { scope } as a second
  //      param: start_run stamps the verified principal (`sub`) into the job for attribution,
  //      and stop_run's QUEUE-id form account-gates against the queued manifest (the runId form is
  //      already gated at the chokepoint; without this an accounts-scoped token could dequeue any
  //      customer's pending job).
  async start_run(args, extra) { const { startRun } = await import("./lib/ops.mjs"); return startRun(args, extra); },
  async stop_run(args, extra) { const { stopRun } = await import("./lib/ops.mjs"); return stopRun(args, extra); },
  async feed_context(args) { const { feedContext } = await import("./lib/ops.mjs"); return feedContext(args); },
  async mark_sent(args) { const { markSent } = await import("./lib/ops.mjs"); return markSent(args); },
  async list_outbox_events() { const { listOutboxEvents } = await import("./lib/ops.mjs"); return listOutboxEvents(); },
  async get_delivery_packet(args) { const { getDeliveryPacket } = await import("./lib/ops.mjs"); return getDeliveryPacket(args); },
  // ack_event is addressed by FILENAME, not runId, so the `authedArgs.runId != null` account gate in
  // attachHandlers below never fires for it. It must carry { scope } into ops.mjs and gate itself there
  // (fix-list A3) — the same reason stop_run's queue-id form takes `extra`.
  async ack_event(args, extra) { const { ackEvent } = await import("./lib/ops.mjs"); return ackEvent(args, extra); },
};

// ---- tool schemas ------------------------------------------------------------------------------

const runIdProp = { runId: { type: "string", description: "The run's full runId (slug-date-codename) OR just its codename." } };
const TOOL_DEFS = [
  // NO RECOMMENDATION. This description used to promise one ("each conflict in 1–2 plain sentences, the
  // recommendation"), which is the contract the brief was honouring when it emitted a `**Recommendation:**`
  // line. The deliverable carries prioritized facts and never advice — the
  // recipient is a lawyer who layers advice on top, and a tool description promising advice is how it
  // comes back. The brief names WHICH PRODUCT the run was instead, resolved from the registry.
  { name: "brief", description: "START HERE for any 'what do you have on X / what did the search find' question — ONE plain-language briefing of a run, in the client-voiced wording (which search product this run was, overall risk in plain words, each conflict in 1–2 plain sentences, any conditions on the result). Facts, never advice. No internal stage names, no risk-formula codes, no model names. Reach for the audit tools (get_run, trace, decision_timeline, get_telemetry) only when the user asks HOW the system reached a conclusion.", inputSchema: { type: "object", properties: { ...runIdProp }, required: ["runId"] } },
  { name: "list_runs", description: "List the searches on this account (in progress and finished), newest first. TO FIND A SEARCH BY THE NAME IT CLEARED, pass `mark` — the stored identifier is a longer prefixed slug a client has never seen, so a bare mark name will not match `slug`. If a filtered call comes back empty, list unfiltered and read down the mark names before telling anyone there is nothing there. States: 'postponed' = paused on a provider cap and resuming by itself (resetsAt); 'recovering' = backing off and retrying (recoveryResumesAt); 'parked-for-human' = interrupted mid-search, resumes on the next activation. sendPending:true is the authoritative list of finished searches still owed their delivery notification. Follow up with brief for a plain-language summary of one search.", inputSchema: { type: "object", properties: { agent: { type: "string" }, state: { type: "string", enum: ["running", "delivered", "failed", "postponed", "recovering", "parked-for-human", "cancelled"] }, mark: { type: "string", description: "Find a search by the MARK it cleared: matches the mark name or the identifier, case-insensitively, on part of the word. This is the parameter a name-shaped question wants." }, slug: { type: "string", description: "EXACT identifier match, for a caller that already holds one. A mark name is not a slug — use `mark`." }, sendPending: { type: "boolean", description: "true = only searches still owed a delivery notification; false = only already-settled ones." }, limit: { type: "number" } } } },
  { name: "list_profiles", description: "List the customer ACCOUNTS the firm runs prelim clearances for (key + name + industry + their PROJECTS) — the roster the intake step resolves a job's profileKey (and optional projectKey) against. profileKey selects that customer's marketplaces, default classes/jurisdictions, report format and risk posture; a project (spec 62) is an engagement UNDER a customer that overlays its own marketplaces/classes/sector/posture. Resolve by JUDGMENT (explicit name, misspelling, or implicit reference); OMIT profileKey for a new/unknown customer (uses the neutral generic profile); set projectKey only when the request names a specific project in that customer's projects[], else OMIT it (runs on the customer profile); never pick a profile from the sender's email domain. Read-only.", inputSchema: { type: "object", properties: {} } },
  { name: "get_run", description: "ENGINEERING/AUDIT view — full run mechanics: status, every pipeline stage (trigger/outcome), failover facts, artifact validity, and a coverage summary. Use when the user asks how the run executed; for 'what did it find', call brief instead.", inputSchema: { type: "object", properties: { ...runIdProp }, required: ["runId"] } },
  { name: "read_artifact", description: "Read a run artifact's raw text (or one '# Section', or its front-matter). For briefing a person, the report is the plain-language layer; the rest are internal working documents. Names: report, audit, narrative, registerFindings, commonLaw, placement, matterContext, variantManifest, skepticFlags, seniorEyeReview, caseLaw, clientSummary (internal cover-note source; ops only), a register axis (e.g. primary-sweep), status.json, run.jsonl.", inputSchema: { type: "object", properties: { ...runIdProp, name: { type: "string" }, section: { type: "string", description: "Return only this '# Section'." }, frontMatterOnly: { type: "boolean" } }, required: ["runId", "name"] } },
  { name: "list_evidence", description: "The records this search considered — every register and common-law entry, including ones the report does not name individually. Each carries the mark, owner and country, the classes, the register status, the source link, whether the provider record was actually retrieved (`retrieved`), and `superseded: true` if a later pass withdrew it. Use this to answer 'what exactly did you find, and who owns it?'. Filter with layer: register | common-law.", inputSchema: { type: "object", properties: { ...runIdProp, layer: { type: "string", enum: ["register", "common-law"] } }, required: ["runId"] } },
  { name: "list_searches", description: "What the search looked for and where — the searches that came back empty as well as the ones that surfaced something. Each row carries the term, the match shapes tried (exact, fuzzy, phonetic, transliteration…), the classes and jurisdictions, the register office where one was named, and the outcome (no-hit | found | out-of-scope | screened-out | excluded-own-rights | negligible). This is the defensibility record: proof of where the search looked and found nothing. Filter by outcome.", inputSchema: { type: "object", properties: { ...runIdProp, outcome: { type: "string", enum: ["no-hit", "found", "out-of-scope", "screened-out", "excluded-own-rights", "negligible", "recorded"] } }, required: ["runId"] } },
  { name: "get_search_coverage", description: "What the search covered and what is still open, in the report's own words — each area with its state (Searched — clean / Partially covered / Open item / Not run this run). An area that is not clean is NOT cleared: read it as open. Reach for this whenever a result looks clean and the user is about to rely on it.", inputSchema: { type: "object", properties: { ...runIdProp }, required: ["runId"] } },
  { name: "list_findings", description: "Structured findings from the deterministic audit. kind: findings (default) | negatives | audit (audit-trail). Filter by sourceLayer (Register/Common-law). Pass group (on-field/off-field/out-of-scope) to get the curated report cards instead — the cards' one-liners are already plain-language.", inputSchema: { type: "object", properties: { ...runIdProp, kind: { type: "string", enum: ["findings", "negatives", "audit"] }, sourceLayer: { type: "string" }, group: { type: "string", enum: ["on-field", "off-field", "out-of-scope"] } }, required: ["runId"] } },
  { name: "get_finding", description: "One finding/negative/audit-trail record by id (F#, NR#, AT#).", inputSchema: { type: "object", properties: { ...runIdProp, id: { type: "string" } }, required: ["runId", "id"] } },
  { name: "trace", description: "ENGINEERING/AUDIT view — HOW a conclusion was reached; use only when the user asks how/why, not for briefing findings. Walks the full logic flow from any target (a stage, an artifact name, a finding id, or 'verdict') back through the stage that emitted it (and whether a failover occurred), its inputs (with sha-at-consumption vs now), the audit-trail rationale, search terms + record URL, skeptic escalations, and the refutation verdict. Pass shallow:true for a fast skeleton (stage→input lineage + verdict only; skips the findings rebuild and the live provider-usage tally).", inputSchema: { type: "object", properties: { ...runIdProp, target: { type: "string", description: "stage | artifact | finding id (F#/NR#/AT#) | 'verdict' | a mark/owner substring" }, depth: { type: "number", description: "upstream recursion depth (default 2)" }, shallow: { type: "boolean", description: "Fast skeleton: lineage + verdict only, skipping the slow enrichments. Use when a full trace is slow or you only need the chain." } }, required: ["runId", "target"] } },
  { name: "get_telemetry", description: "ENGINEERING/AUDIT view — per-run + per-stage execution telemetry (models, tokens, wall, failovers, fail reasons) from run.jsonl + the per-attempt logs. The ONLY tool that reports model identity — keep model names out of answers unless explicitly asked. Pass stage (+axis) to focus.", inputSchema: { type: "object", properties: { ...runIdProp, stage: { type: "string" }, axis: { type: "string" } }, required: ["runId"] } },
  { name: "get_provider_usage", description: "ENGINEERING/AUDIT view — billed register-search provider call counts for the run, RECOMPUTED live from the ledger (more correct than the cached value) with a drift/low-confidence flag.", inputSchema: { type: "object", properties: { ...runIdProp }, required: ["runId"] } },
  { name: "get_coverage", description: "What was searched vs what's a gap: per-register-axis presence/validity, the coverage-ledger marker, negative-results count, and per-artifact validity.", inputSchema: { type: "object", properties: { ...runIdProp }, required: ["runId"] } },
  { name: "search", description: "Keyword search across one run's artifacts (single-run scope), ranked. mode 'all' (default) = every query word must appear on the line, any order (so 'MYRKUR similar mark conflict' matches a line about all four); 'any' = ≥1 word, ranked by how many; 'phrase' = the exact substring (old behaviour). Returns {artifact, line, score, snippet}. Optional kind to scope to one artifact.", inputSchema: { type: "object", properties: { ...runIdProp, query: { type: "string" }, kind: { type: "string" }, mode: { type: "string", enum: ["all", "any", "phrase"] }, limit: { type: "number" } }, required: ["runId", "query"] } },
  { name: "decision_timeline", description: "ENGINEERING/AUDIT view — the run's DECISION timeline: an ordered milestone list projected from the event log — stages (with trigger and a 'changedFromPrevious' marker when a stage was recomputed), skeptic escalations (with the reason), the verdict(s) (with the reviewer's head note), screen-gates, and the terminal outcome. Answers 'how did the verdict evolve?' in one call; for 'what did it find', call brief instead.", inputSchema: { type: "object", properties: { ...runIdProp }, required: ["runId"] } },
  { name: "run_changes", description: "Change-feed for monitoring a live run: the timeline events since a timestamp, plus a cursor to poll with. MCP has no push, so poll again with since=cursor. Optional kinds[] to filter event kinds (e.g. ['verdict','skeptic-escalation','failed']).", inputSchema: { type: "object", properties: { ...runIdProp, since: { type: "string", description: "Poll cursor — a stable sequence number from a prior call's `cursor` (preferred), OR an ISO timestamp for the first call. Returns only newer events; omit for the full timeline." }, kinds: { type: "array", items: { type: "string" }, description: "Optional event-kind filter." } }, required: ["runId"] } },
  { name: "diff_artifact", description: "Diff two versions of an artifact (what actually changed between them). Versions exist only when something snapshotted them — an in-place re-dispatch (_history) or a what-if experiment (_experiments); the automated escalation/correction overwrites in place, so a normal run has only 'canonical' and there's nothing to diff (reported honestly). Defaults: a=canonical, b=newest snapshot.", inputSchema: { type: "object", properties: { ...runIdProp, name: { type: "string", description: "Artifact: registerFindings, narrative, report, placement, a register axis (e.g. primary-sweep), …" }, a: { type: "string", description: "ref for THIS run: canonical | _history/<dir> | _experiments/<dir> (must be a real snapshot of this artifact; absolute/`..` paths are rejected). Default canonical." }, b: { type: "string", description: "ref (same grammar as a). Default = newest _history snapshot for this artifact." }, axis: { type: "string", description: "Required (and validated against the known axes) only if name is a bare 'register-unit'." } }, required: ["runId", "name"] } },
  { name: "search_runs", description: "Cross-run search across ALL runs (in-flight + archived) — e.g. 'has the MYRK- root shown up in prior clearances?'. scope: findings (default; the mark/owner/search-term columns — cheapest), audit, key-artifacts (report+registerFindings+commonLaw+narrative), or all-artifacts (full text, most expensive). Same ranked all|any|phrase modes as search. Capped by maxRuns.", inputSchema: { type: "object", properties: { query: { type: "string" }, mode: { type: "string", enum: ["all", "any", "phrase"] }, scope: { type: "string", enum: ["findings", "audit", "key-artifacts", "all-artifacts"] }, agent: { type: "string" }, state: { type: "string", enum: ["running", "delivered", "failed", "postponed", "recovering", "parked-for-human", "cancelled"] }, slug: { type: "string" }, maxRuns: { type: "number" }, limit: { type: "number" } }, required: ["query"] } },
  { name: "what_if_plan", description: "DRY-RUN a what-if (no spend), in one of two kinds. kind 'stage' (the default) re-runs a single stage of a LIVE run: what re-runs, the cost prior, what downstream is NOT recomputed, a completeness verdict, and a confirmationToken — pass `stage`, and express the change via instructions (e.g. 'treat ACME as expired') and/or model. kind 'memo' answers a what-if about a DELIVERED report instead: a bounded re-read of that run's archived findings and records under a stated assumption, spending model tokens only — no searching, no register calls, and the report and its archive are never modified. A memo takes no stage; put the reader's own words in `instructions`.", inputSchema: { type: "object", properties: { ...runIdProp, kind: { type: "string", enum: ["stage", "memo"], description: "'stage' (default) re-runs one stage of a live run; 'memo' reasons over a delivered run's archived evidence." }, stage: { type: "string", description: "Required for kind 'stage'. A memo re-runs no stage and must not pass one." }, axis: { type: "string" }, instructions: { type: "string", description: "For kind 'memo' this is REQUIRED and is the assumption to apply, in the reader's own words." }, model: { type: "string" } }, required: ["runId"] } },
  { name: "what_if_run", description: "EXECUTE a planned what-if (SPENDS tokens / maybe billed calls): re-runs ONE stage in a sandbox (original untouched) and diffs it. Requires the confirmationToken from what_if_plan. Approval-gated — confirm cost before calling. Over the client connector this QUEUES the experiment on the server and returns an experimentId instead of a diff — pass `runId` too, and collect the result with what_if_result.", inputSchema: { type: "object", properties: { confirmationToken: { type: "string" }, ...runIdProp }, required: ["confirmationToken"] } },
  { name: "what_if_result", description: "Collect a QUEUED what-if: its state (queued | running | done | failed) and, once done, the diff against the canonical run. Pass runId and the experimentId what_if_run returned; omit experimentId to list every what-if asked of this run. The original run is never modified — the experiment lives in its own sandbox.", inputSchema: { type: "object", properties: { ...runIdProp, experimentId: { type: "string" } }, required: ["runId"] } },
  // ---- Option discovery + the free preview (NO ops token; both accountSafe, both write nothing —
  // a client connector's first two calls) ----
  { name: "describe_options", description: "START HERE before composing a search — the option space, for free. Returns the four searches this deployment can actually run — each with the geography it accepts, how many names it reads, its turnaround, whether it carries the case-law reading, whether the native-language investigation is optional or automatic, and a plain note when one is unavailable — plus the combination rules the servers enforce (territories, native-language routing, marketplaces, classes, names per search), and — for a client connector — YOUR OWN account: its key (the profileKey plan_run and start_run require), its projects, its saved searches (the recipeKey slugs) and what is left of today's allowance. Omit profileKey to be answered about your own account(s); pass it to ask about a specific one. Reserves nothing, spends nothing, starts nothing. Then: plan_run (free) with the arguments you intend, and start_run with the SAME arguments once the requester has confirmed.", inputSchema: { type: "object", properties: { profileKey: { type: "string", description: "OPTIONAL: the customer ACCOUNT key to describe. Omit it to be answered about the account(s) this session holds — that is how a client connector discovers the key it must pass to plan_run/start_run." } } } },
  { name: "plan_run", description: "FREE PREVIEW — resolve what a search WOULD do and return it, spending nothing and queueing nothing. Takes the SAME arguments as start_run. Use this BEFORE start_run whenever the requester has not already confirmed the specifics: it reports the PRODUCT that resolves and WHERE it came from (their request, the account default, a saved search, or the territories themselves), the territories and marketplaces that would ACTUALLY be searched, the turnaround, and any blockers as questions to put back. Show the result to the requester; then call start_run with the SAME arguments to actually run it. Nothing here reserves or holds anything.", inputSchema: { type: "object", properties: { markName: { type: "string", description: "The mark (single-mark form). REQUIRED unless marks[] is given." }, marks: { type: "array", items: { type: "object", properties: { name: { type: "string" }, classes: { type: "array", items: { type: "number" } }, ref: { type: "string" } }, required: ["name"] } }, classes: { type: "array", items: { type: "number" } }, goods: { type: "string" }, jurisdictions: { type: "array", items: { type: "string" } }, platforms: { type: "array", items: { type: "string" } }, customer: { type: "string" }, profileKey: { type: "string", description: "The customer ACCOUNT key (see list_profiles). REQUIRED for an accounts-scoped session (your grant names the keys — see describe_options)." }, projectKey: { type: "string" }, forwarder: { type: "string", description: "Requester/reply-routing key — same as start_run, so the preview describes the job that would actually be built. Account sessions may omit it — it is stamped from your verified identity." }, forwarderEmail: { type: "string" }, ref: { type: "string" }, product: { type: "string", enum: ORDERABLE_PRODUCTS, description: PRODUCT_DESC }, nativeLanguage: { type: "boolean", description: "OPTIONAL, and only on a multi-country-focus-search: the native-language investigation. Send TRUE or omit the field — FALSE IS REFUSED, not honoured: the toggle only ever added, so there is nothing for false to switch off, and accepting it would let you believe you had removed a reading that runs anyway. It runs AUTOMATICALLY on a full-country-search and is not part of the other two, so asking for it there is refused rather than accepted and ignored. It routes on territory — the scope must name one it covers." }, worldwide: { type: "boolean", description: "Search EVERYWHERE, and refuse to be narrowed by the account's own default territories. This is not the same as omitting jurisdictions, which means \"whatever the account says\" — the two used to be indistinguishable on this wire, which is how a request that bought everywhere ran an account's seven countries. Never send \"Worldwide\" as a jurisdictions entry." }, recipeKey: { type: "string" }, upfrontInstructions: { type: "string" }, deadline: { type: "string" }, deliveryRoute: { type: "string", enum: ["email", "portal"], description: "OPTIONAL: how the delivered packet leaves — email (default). \"portal\" is reserved for the portal delivery lane and CLARIFIES at admission until it ships (never a silent no-op) — so the preview BLOCKS it here rather than describing a job start_run could not run." }, commercialFlexibility: { type: "string" }, priorUse: { type: "string" }, campaignShape: { type: "string", description: "Campaign-shape FACTS from the request/client — how the mark will be deployed: standalone brand vs flavour/sub-brand under a NAMED house mark; seasonal/limited vs permanent; launch scale. Verbatim facts only — the engine records them on the matter frame instead of inferring a launch shape." }, customerUnknown: { type: "boolean" } }, required: ["forwarder"] } },
  // ---- OPS write-face (requires an ops token; never exposed to a user/internal session) ----
  { name: "start_run", description: "OPS-ONLY. Enqueue a NEW clearance/search run the driver will pick up. Provide markName (or marks[] for a batch) + forwarder (and ideally classes/goods/customer/profileKey/ref). Returns the queue id + slug; the runId/codename is assigned when the runner claims it — poll list_runs (by markName) or run_changes for progress. Spends real money once it runs.", inputSchema: { type: "object", properties: { agent: { type: "string", description: "Which agent workspace's queue. Omit for the deployment default (CLEAROTRON_QUEUE_DIR or the default agent's queue — docs/INTAKE.md)." }, markName: { type: "string", description: "The mark (single-mark form). Required unless marks[] is provided." }, marks: { type: "array", items: { type: "object", properties: { name: { type: "string" }, classes: { type: "array", items: { type: "number" } }, ref: { type: "string" } }, required: ["name"] }, description: "Batch form: EVERY name of the batch in ONE job. Only a knockout-search reads more than one name at a time; a clearance reads one, and more is refused rather than truncated." }, classes: { type: "array", items: { type: "number" }, description: "Nice classes — whole numbers 1–45 (1–34 goods, 35–45 services). classes OR goods; either suffices." }, goods: { type: "string" }, jurisdictions: { type: "array", items: { type: "string" }, description: "WHERE the search points — and, for a clearance, WHICH search it is: one country is a full-country-search, a region or two-or-more countries a multi-country-focus-search. AUTHORITATIVE (the matter frame is told not to widen past them). Omit ⇒ the project/customer default territories; send worldwide:true to search everywhere instead. Names or codes both read; max 20." }, platforms: { type: "array", items: { type: "string" }, description: "OPTIONAL per-run SCOPE: extra marketplaces to sweep, as bare store domains e.g. [\"gnc.com\"]. ADDED to the account's own marketplaces — additive only, never a replacement (a client's platform list is a mandate). Max 10; \"web\" is implicit and must not be listed." }, customer: { type: "string" }, profileKey: { type: "string", description: "The customer ACCOUNT key (see list_profiles) whose profile rates this run; omit for the neutral generic profile. REQUIRED for an accounts-scoped session (your grant names the keys — see describe_options)." }, forwarder: { type: "string", description: "Requester/reply-routing key — rides the delivery packet so the integrator knows who gets the report (docs/DELIVERY.md). Account sessions may omit it — it is stamped from your verified identity." }, forwarderEmail: { type: "string" }, ref: { type: "string" }, provider: { type: "string" }, brief: { type: "string" }, upfrontInstructions: { type: "string" }, projectKey: { type: "string", description: "OPTIONAL (spec 62): the PROJECT/engagement key UNDER profileKey (see that customer's projects[] in list_profiles) whose overlay rates this run; omit to run on the customer profile. An unknown key clarifies at intake." }, product: { type: "string", enum: ORDERABLE_PRODUCTS, description: PRODUCT_DESC }, nativeLanguage: { type: "boolean", description: "OPTIONAL, and only on a multi-country-focus-search: the native-language investigation. Send TRUE or omit the field — FALSE IS REFUSED, not honoured: the toggle only ever added, so there is nothing for false to switch off, and accepting it would let you believe you had removed a reading that runs anyway. It runs AUTOMATICALLY on a full-country-search and is not part of the other two, so asking for it there is refused rather than accepted and ignored. It routes on territory — the scope must name one it covers." }, worldwide: { type: "boolean", description: "Search EVERYWHERE, and refuse to be narrowed by the account's own default territories. This is not the same as omitting jurisdictions, which means \"whatever the account says\" — the two used to be indistinguishable on this wire, which is how a request that bought everywhere ran an account's seven countries. Never send \"Worldwide\" as a jurisdictions entry." }, recipeKey: { type: "string", description: "OPTIONAL alternative selector: a saved search (recipe) slug for this customer. Mutually exclusive with product — a saved search already carries one." }, deliveryRoute: { type: "string", enum: ["email", "portal"], description: "OPTIONAL: how the delivered packet leaves — email (default). \"portal\" is reserved for the portal delivery lane and CLARIFIES at admission until it ships (never a silent no-op)." }, parentRunId: { type: "string", description: "OPTIONAL escalation lineage: the runId this run escalates from (e.g. a knockout HIGH mark → this prelim)." }, deliverableSpec: { type: "string" }, commercialFlexibility: { type: "string" }, priorUse: { type: "string" }, campaignShape: { type: "string", description: "Campaign-shape FACTS from the request/client — how the mark will be deployed: standalone brand vs flavour/sub-brand under a NAMED house mark; seasonal/limited vs permanent; launch scale. Verbatim facts only — the engine records them on the matter frame instead of inferring a launch shape." }, deadline: { type: "string", description: "ISO-8601 — drives the deadline envelope." }, customerUnknown: { type: "boolean" }, dupOverride: { type: "boolean", description: "Requester-confirmed force-run past matter dedup." }, clientPrincipal: { type: "boolean", description: "Set by the client portal only: this run was started by a CLIENT and consumes that account's runCaps.dailyRuns allowance. Omit for staff, agent and email-door runs — absence means uncapped, and setting it can only restrict the run that carries it." }, rawRequest: { type: "string" }, forwarderDomain: { type: "string" }, msgId: { type: "string" }, conversationId: { type: "string" }, id: { type: "string" } }, required: ["forwarder"] } },
  { name: "stop_run", description: "OPS-ONLY. Cancel a run. Pass id to remove a not-yet-claimed queued job (a real cancel, no spend). Pass runId to file a cancel request on a started run. By default the cancel is COOPERATIVE — the sentinel is written and a turn already in flight is allowed to finish, which has no deadline: a reasoning turn can run for tens of minutes. Add immediate:true to also end that turn, so the run goes terminal in seconds.", inputSchema: { type: "object", properties: { agent: { type: "string" }, id: { type: "string", description: "A queued job id (from start_run) — dequeues before the runner claims it." }, runId: { type: "string", description: "A started run's runId — files a cancel sentinel." }, immediate: { type: "boolean", description: "Stop NOW instead of at the next step boundary (tracker issue 2076). The cancel sentinel is written FIRST and then the run's own recorded engine turn is ended, in that order — the sentinel is what makes the record clean, so the terminal names the stage, the actor and the request time instead of leaving a run that reads as still running. The step in flight is lost; everything already recorded is kept. Falls back to the boundary stop, and SAYS SO in the answer, when there is no live turn to end — a run between steps, or one whose turn has already exited. Never send this expecting a guaranteed instant stop: the answer states which of the two actually happened."}, onBehalfOf: { type: "string", description: "The identifier of a human this caller has itself verified (#1378). RECORDED BESIDE the token's own principal, never instead of it — a stop by the portal for alice@x is written `portal:alice@x`, so an asserted name is never mistaken for a proved one. Bare identifiers only; anything else is dropped." } } } },
  { name: "server_info", description: "The AGPL §13 source offer: this server's name, version, licence, source repository and the COMMIT IT IS RUNNING. Callable by every session kind — the offer is owed to whoever interacts with the service. Reads no run and no account data.", inputSchema: { type: "object", properties: {} } },
  { name: "list_outbox_events", description: "Integrator discovery read (docs/DELIVERY.md): every pending outbox event — delivered markers plus the self-contained run-failed / intake-rejected / duplicate-skipped / late-bind-ack packets. Route each, then mark_sent (delivered) or ack_event (the rest).", inputSchema: { type: "object", properties: {} } },
  { name: "get_delivery_packet", description: "The run's send payload: _driver/delivery.json (subject, recipient routing, verbatim emailBodyHtml, whatsapp line) and/or failure.json, plus sendPending/.sent state. NOT exposed to client tokens.", inputSchema: { type: "object", properties: { runId: { type: "string" } }, required: ["runId"] } },
  { name: "ack_event", description: "OPS-ONLY. Consume ONE routed outbox event by its file name (from list_outbox_events). Idempotent (ok+alreadyGone). The delivered marker is instead cleared by mark_sent.", inputSchema: { type: "object", properties: { file: { type: "string" } }, required: ["file"] } },
  { name: "mark_sent", description: "OPS-ONLY. Integrator write-back after sending a delivered run's packet (docs/DELIVERY.md step 3): writes the .sent idempotency guard, clears status.sendPending, removes the outbox marker. Idempotent — an already-sent run returns ok+alreadySent. SETTLING REQUIRES EVIDENCE: pass messageId or attestation, or the call refuses. Never call this for a send that was blocked or failed — leave the marker so the send stays owed.", inputSchema: { type: "object", properties: { runId: { type: "string" }, messageId: { type: "string", description: "The sent email's messageId — the send receipt." }, attestation: { type: "string", description: "Out-of-band evidence when there is no messageId: an explicit statement of how the packet actually reached the reader (channel + when), recorded VERBATIM in .sent." } }, required: ["runId"] } },
  { name: "feed_context", description: "OPS-ONLY. Late-bind context onto a run: the applicant + exclusions (written as customer-bind.json, the pipeline's pre-start applicant bind) and/or free-text instructions for the reviewer. Use to resolve a customer-unknown run or steer a re-run.", inputSchema: { type: "object", properties: { runId: { type: "string" }, customer: { type: "string" }, exclusions: { type: "array", items: { type: "string" } }, instructions: { type: "string" } }, required: ["runId"] } },
];

// ---- handler wiring (shared by the stdio + HTTP entrypoints) ------------------------------------

// Resources: raw artifact bytes, addressable as trademark://run/<runId>/<artifact>. ListResources is bounded
// to the latest few runs' key artifacts; ReadResource resolves any run/artifact. All read-only.
// / AGPL §13 — the source offer's resource URI, named once so the lister and the reader cannot
// drift apart. Not under trademark://run/ because it is about the SERVER, not about any run.
export const ABOUT_URI = "trademark://about";

const KEY_ARTIFACTS = ["report", "audit", "narrative", "registerFindings", "commonLaw", "matterContext", "status.json", "run.jsonl"];

// Attach the MCP request handlers to a Server. toolDefs/toolImpls let the HTTP entrypoint pass a restricted
// (read-only) surface while the stdio entrypoint gets the full set; resources are always read-only.
// A user token is pinned to ONE run; resolve both ids to runDirs so a codename and a full runId for the
// SAME run are treated as equal (and anything else is refused). Returns true if reqId resolves to scopeRunId.
function sameRun(reqId, scopeRunId) {
  if (!scopeRunId) return false;
  if (String(reqId) === String(scopeRunId)) return true;
  const a = resolveRun(String(reqId)), b = resolveRun(String(scopeRunId));
  return !!(a && b && a.runDir === b.runDir);
}

// ---- named prompts: the one-click questions a client actually asks --------------
//
// MCP prompts are surfaced by the client as named actions, so this is the connector's front door for a
// user who has not yet typed anything. Each one is written the way the owner asks the question, and its
// text steers the ANSWER — the layers to read before answering, and the register to answer in — because
// the failure these exist to prevent is an articulate answer that is wrong about the product.
//
// SCOPE-GATED like the packs. A report-link principal holds one finished search and four tools; offering
// it "Compare the search options" would advertise a thing its own briefing calls out of scope. The gate
// is guidance-shaped, not authority: a prompt cannot reach a tool the principal may not call, and
// authorize() is untouched by anything here.
const PROMPTS = [
  {
    name: "explain-my-report",
    title: "Explain my report",
    description: "A plain-language walk through what this search concluded and what it means for the filing decision.",
    audiences: ["user", "account"],
    text: "Walk me through this clearance report. Lead with the conclusion and the conditions attached to it, then the conflicts that drive it, most material first. Use the report's own verdict language and its own qualifications — do not soften or sharpen them. Write for a lawyer: short sentences, ordinary nouns, no internal names of documents, steps or systems.",
  },
  {
    name: "walk-me-through-the-risks",
    title: "Walk me through the risks",
    description: "The conflicts in order of how much they actually threaten the filing, with the evidence behind each.",
    audiences: ["user", "account"],
    text: "Take me through the risks in this search, most material first. For each: who holds the right, where, over what goods or services, how close it is to my mark, and what it would take to get past it. Keep the report's ranking — an on-field conflict outranks a watchlist note, and do not promote one into the other. Say for each whether the underlying record was actually retrieved or the citation rests on a write-up.",
  },
  {
    name: "what-wasnt-covered",
    title: "What wasn't covered",
    description: "The honest edges of this search: what it did not reach, and what came back empty rather than clean.",
    audiences: ["user", "account"],
    text: "Tell me what this search did NOT cover, and be precise about the difference between an area that was searched and came back empty and an area that was never reached. Read the coverage statement and the searches that returned nothing before you answer. A reading that ran and found nothing is a result — report it as one, and do not describe it as a gap. Then state the real gaps plainly, in one place, without burying them under the clean parts.",
  },
  {
    name: "compare-the-search-options",
    title: "Compare the search options",
    description: "What this account can order, what each search covers, and which one fits the question being asked.",
    audiences: ["account"],
    text: "What searches can I order on this account? Check what this deployment can actually run rather than reciting a menu, and put the real choices to me: what each one covers, the geography it accepts, how many names it reads, its turnaround, and whether it carries the case-law reading. Say which one fits my question and why, and tell me anything about my account that constrains the choice — the allowance left, the saved searches, the default territories. Do not start anything.",
  },
  {
    name: "draft-a-note-to-my-team",
    title: "Draft a note to my team about this result",
    description: "A short internal note stating the result, the conditions on it, and what happens next.",
    audiences: ["user", "account"],
    text: "Draft a short note I can send my team about this result. State the conclusion in the first sentence, then the conditions attached to it, then the one or two conflicts that a colleague needs to know about, then what happens next. Keep the report's qualifications intact and flag anything the search did not cover that bears on the decision. Plain professional prose, no internal system names, no headings unless the note runs past a screen.",
  },
];

/** The prompts this audience is offered. Ops and staff get none — they are not the client surface. */
export function promptsFor(kind) {
  return PROMPTS.filter((p) => p.audiences.includes(kind))
    .map(({ name, title, description }) => ({ name, title, description }));
}

/** One prompt's text, or null when this audience is not offered it. */
export function promptText(kind, name) {
  const p = PROMPTS.find((x) => x.name === name && x.audiences.includes(kind));
  return p ? p.text : null;
}

// ---- the client-facing cut of a tool description ---------------------------------
//
// THE HOLE THIS FILLS. visibleTools() filters tool NAMES per audience and nothing filtered the text
// that rides with them, so a lawyer's assistant on an account token was handed descriptions written
// for our own operators: "ENGINEERING/AUDIT view", run.jsonl, status.json, the skeptic stage — and,
// worst of the set, `start_run` opening with "OPS-ONLY" at the one principal that is entitled to call
// it, which is a description training the assistant to refuse the thing the client is paying for.
//
// This is the same class as the pack itself: pack, BRIEFING_NOTE and tool descriptions
// are three surfaces instructing one actor, and only the first two had a wall. The client cut is a
// TEXT swap only — the tool set, the schemas and every gate are untouched, exactly as instructionsFor
// widens what an assistant is told and never what it may do.
//
// The readable-artifact lists are COMPUTED from the same sets authorize() enforces, never re-typed: a
// hand-written list is how a description comes to advertise an artifact the gate refuses by name.
const CLIENT_TOOL_TEXT = {
  read_artifact: (kind) =>
    `Read one of this search's documents, or a single "# Section" of one. "report" is the report itself — the plain-language layer, and the right answer to almost every question about what the search concluded. Readable here: ${[...(kind === "user" ? USER_ARTIFACTS : ACCOUNT_ARTIFACTS)].join(", ")}${kind === "user" ? "" : ', or one register pass as "registerUnit:<axis>". "commonLaw" carries the off-register use layer AND the meaning-and-connotation reading — read it before saying a search did not look at what a name means'}. Anything else on the search is internal and refused by name.`,
  get_run: () =>
    "What actually happened during this search: which steps ran, in what order, what each produced, whether anything was retried, and where it stands now. Use it when the user asks how the search was carried out; for what it found, call brief instead.",
  trace: () =>
    "How a conclusion was reached. Give it a finding id, a document name or 'verdict' and it walks back through the step that produced it, the inputs that step read, the recorded rationale, the search terms and record link, any escalation, and the review that gated delivery. This is the drill-through for a conclusion being questioned — not for briefing findings. Pass shallow:true for the chain and verdict alone.",
  decision_timeline: () =>
    "The search's decisions as a dated list: steps completed and recomputed, escalations and why, the verdict as it evolved, the screening gate, and the outcome. Answers 'how did the verdict change?' in one call; for what it found, call brief instead.",
  plan_run: () =>
    "FREE PREVIEW — what a search WOULD do, spending nothing and starting nothing. Takes the SAME arguments as start_run and reports the search that resolved and where that came from (the request, the account default, a saved search, or the territories themselves), the territories and marketplaces that would actually be searched, the turnaround, and any blockers to put back to the requester. Show the result to them, then call start_run with the SAME arguments.",
  start_run: () =>
    "Commissions a real search. It costs the client money and takes hours. Provide markName (or marks[] for a batch that a knockout search reads) plus the classes or goods, the territories, and the account key. Call plan_run first and have the requester confirm. The search's own identifier is assigned when it starts — find it afterwards with list_runs by mark.",
  stop_run: () =>
    "Cancels a search that is waiting or in progress. Nothing already delivered is affected.",
  what_if_result: () =>
    "Collect a what-if: its state (queued, running, done or failed) and, once done, what it changed against the original search. Pass runId and the experimentId what_if_run returned; omit experimentId to list every what-if asked of this search. The original is never modified — the experiment runs in its own sandbox.",
};

/**
 * The tool list as THIS audience should read it. A client principal (a report link) and an account
 * principal get the client cut where one exists; ops and staff get the operator text unchanged.
 * Descriptions only — name, inputSchema and everything the gate reads pass through untouched.
 */
export function describeForAudience(def, kind) {
  if (kind !== "user" && kind !== "account") return def;
  const text = CLIENT_TOOL_TEXT[def.name];
  return text ? { ...def, description: text(kind) } : def;
}

/**
 * Attach MCP tool annotations — tracker issue 148.
 *
 * No tool declared any, so a client could not tell `brief` from `start_run` and asked before every
 * call. `readOnlyHint` is DERIVED from the scope table's `write` flag (`readOnlyFor`) rather than
 * hand-maintained here: a second name for one fact desynchronises the moment one is edited, and this
 * fact already decides who may call the tool at all.
 *
 * `destructiveHint` is deliberately NOT set. The SDK's default for a non-read-only tool is the
 * cautious one, and claiming a write is non-destructive is a promise this table cannot keep.
 */
export function withAnnotations(def) {
  return { ...def, annotations: { readOnlyHint: readOnlyFor(def.name) } };
}

export function attachHandlers(server, { scope = { kind: "ops", runId: null }, local = true } = {}) {
  const allow = visibleTools({ kind: scope.kind, local });
  const toolDefs = TOOL_DEFS.filter((d) => allow(d.name)).map((d) => withAnnotations(describeForAudience(d, scope.kind)));
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: toolDefs }));

  // Prompts are guidance, like the pack: offered to the two client audiences, empty for everyone else.
  server.setRequestHandler(ListPromptsRequestSchema, async () => ({ prompts: promptsFor(scope.kind) }));
  server.setRequestHandler(GetPromptRequestSchema, async (req) => {
    const name = req.params?.name;
    const text = promptText(scope.kind, name);
    // An unoffered name is refused BY NAME rather than answered with an empty message — an empty prompt
    // reads to the model as "there is nothing to ask here", which is the absence-as-pass shape.
    if (!text) throw new Error(`unknown prompt "${name}"`);
    return { messages: [{ role: "user", content: { type: "text", text } }] };
  });

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: args = {} } = req.params;
    const fn = tools[name];
    if (!fn) return { isError: true, content: [{ type: "text", text: `unknown tool "${name}"` }] };
    // INNER GATE: authorize() throws if this scope may not call this tool / reach this run; it returns the
    // (run-pinned) args to dispatch. The single chokepoint every tool call flows through.
    let authedArgs;
    try { authedArgs = authorize(scope, name, args); }
    catch (e) { log(`authz deny ${name} [${scope.kind}]: ${e.message}`); return { isError: true, content: [{ type: "text", text: `FORBIDDEN (${name}): ${e.message}` }] }; }
    // ACCOUNT GATE (GRANTS, INSTALL.md §8): a run-addressed call from an account-scoped session must
    // target a run inside the grant. Enforced BEFORE dispatch so a denied run leaks nothing — not even
    // its existence (the deny message names the account, never the run's contents).
    if (Array.isArray(scope?.accounts) && authedArgs?.runId != null) {
      try {
        const run = resolveRun(String(authedArgs.runId));
        if (run) assertAccountAccess(scope, runAccountKey(run), `run "${authedArgs.runId}"`);
      } catch (e) {
        log(`account deny ${name} [${scope.sub ?? scope.kind}]: ${e.message}`);
        return { isError: true, content: [{ type: "text", text: `FORBIDDEN (${name}): ${e.message}` }] };
      }
    }
    try {
      let result = await fn(authedArgs, { scope });
      // ACCOUNT FILTER: enumeration results narrow to the grant. Events with no resolvable run
      // (intake rejections before a run exists) stay visible only to full-grant sessions.
      if (Array.isArray(scope?.accounts)) result = filterByAccounts(scope, name, result);
      // CLIENT VIEW: a client principal gets the client cut of artifact text ( R1).
      result = presentForPrincipal(scope, name, result);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (e) {
      log(`tool ${name} error: ${e.message}`);
      return { isError: true, content: [{ type: "text", text: `ERROR (${name}): ${e.message}` }] };
    }
  });

  server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => ({
    resourceTemplates: [{ uriTemplate: "trademark://run/{runId}/{artifact}", name: "prelim run artifact", description: "Raw text of a run artifact (report, audit, narrative, registerFindings, commonLaw, matterContext, a register axis, status.json, run.jsonl).", mimeType: "text/markdown" }],
  }));
  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    // / AGPL §13 — LISTED FIRST, AND FOR EVERY SCOPE. An offer nobody can find is not an offer, and
    // the whole point of the resource form is that a client which never calls a tool still meets it.
    const resources = [{ uri: ABOUT_URI, name: "about this server", mimeType: "application/json",
      description: "Source offer (AGPL §13): name, version, licence, source repository and the commit this server is running." }];
    // A run-scoped (user) token sees ONLY its bound run's artifacts; ops/internal see the latest few runs.
    const runs = scope.kind === "user"
      ? (() => { const r = scope.runId && resolveRun(scope.runId); return r ? [r] : []; })()
      : enumerateRuns()
          .filter((r) => !Array.isArray(scope?.accounts) || accountVisible(scope, runAccountKey(r)))
          .slice(0, 8).map((r) => ({ ...r, P: paths(r.runDir) }));
    // A user (report-link) token sees ONLY the report (one report — never a second version by another
    // name), never the internal KEY_ARTIFACTS (narrative/audit/run.jsonl/…) — the same gate authorize()
    // puts on read_artifact.
    //
    // AND THE TWO CLIENT KINDS NO LONGER AGREE (owner ruling 2026-08-27). They did while both read only
    // the report; the account layer now reads the audit chain and the report link still does not. This
    // is keyed on the KIND rather than on CLIENT_KINDS for exactly that reason — leaving it collapsed
    // would have made the tool surface serve an account the audit chain while this door went on sealing
    // it to the report, which is two surfaces disagreeing about one grant.
    const artifactsFor = (kind) =>
      kind === "account" ? [...ACCOUNT_ARTIFACTS, ...REGISTER_AXES.map((ax) => `registerUnit:${ax}`)]
        : CLIENT_KINDS.has(kind) ? [...USER_ARTIFACTS] : KEY_ARTIFACTS;
    for (const run of runs) {
      for (const name of artifactsFor(scope.kind)) {
        const p = artifactPath(run, name);
        if (p && existsSync(p)) resources.push({ uri: `trademark://run/${run.runId}/${name}`, name: `${run.runId} · ${name}`, mimeType: mimeFor(p) });
      }
    }
    return { resources };
  });
  server.setRequestHandler(ReadResourceRequestSchema, async (req) => {
    // / AGPL §13 — the same offer as a RESOURCE, above the run gate because it is about the server
    // and not about any run. A client token reaches it for the same reason it reaches the tool.
    if (req.params.uri === ABOUT_URI)
      return { contents: [{ uri: ABOUT_URI, mimeType: "application/json", text: JSON.stringify(productIdentity(), null, 2) }] };
    const m = /^trademark:\/\/run\/([^/]+)\/(.+)$/.exec(req.params.uri);
    if (!m) throw new Error(`bad resource uri: ${req.params.uri}`);
    const reqRunId = decodeURIComponent(m[1]);
    const reqArtifact = decodeURIComponent(m[2]);
    if (scope.kind === "user" && !sameRun(reqRunId, scope.runId)) throw new Error("forbidden: this token is scoped to a single run");
    // THE SAME GATE authorize() APPLIES TO read_artifact, kind for kind — a report link to the report, a
    // client account to the audit chain. A single CLIENT_KINDS test here would seal the account layer's
    // own artifacts behind the URI door the tool door opens.
    if (scope.kind === "account" && !accountMayReadArtifact(reqArtifact))
      throw new Error(`forbidden: artifact "${reqArtifact}" is not readable by a client account`);
    if (scope.kind === "user" && !USER_ARTIFACTS.has(reqArtifact))
      throw new Error("forbidden: a client may only read the report");
    const run = resolveRun(reqRunId);
    if (!run) throw new Error(`run not found: ${m[1]}`);
    if (Array.isArray(scope?.accounts)) assertAccountAccess(scope, runAccountKey(run), `run "${reqRunId}"`);
    const path = artifactPath(run, reqArtifact);
    if (!path || !existsSync(path)) throw new Error(`artifact not found: ${m[2]}`);
    // CLIENT VIEW ( R1): the Resources surface is a second door to the same bytes — it applies the
    // same client cut the read_artifact tool does, so a client cannot route around the scrub via a URI.
    const text = readCapped(path);
    return { contents: [{ uri: req.params.uri, mimeType: mimeFor(path), text: CLIENT_KINDS.has(scope.kind) ? scrubMarkdown(text) : text }] };
  });
  return server;
}

// ---- CLIENT VIEW ( R1) --------------------------------------------------------------------
// OUTPUT policy, at the same chokepoint as INPUT policy (authorize): a client principal is handed the
// CLIENT cut of any artifact text — the same one the delivered report shows — never the internal cut.
// read_artifact returned raw report.md, which carries `- [internal]` bullets, the internal band code and
// the framework profile hash; brief scrubbed its own output and read_artifact did not. Keeping the rule
// HERE (not in each tool) is why that asymmetry cannot come back: a new client-reachable read is scrubbed
// by default. Staff/ops principals are untouched — they read the internal cut, byte-identical to before.
// Exported for the unit test.
export const CLIENT_KINDS = new Set(["user", "account"]);

/** Thrown when a client-reachable tool has no declared disposition. Never reached by staff or ops. */
export class UndeclaredPresentation extends Error {
  constructor(name) {
    super(`${name} has no declared client presentation — add \`present\` to TOOL_SCOPES in shared/scope.mjs`);
    this.name = "UndeclaredPresentation";
    this.tool = name;
  }
}

export function presentForPrincipal(scope, name, result) {
  if (!CLIENT_KINDS.has(scope?.kind)) return result;

  // — DEFAULT DENY, and it is the SHAPE that enforces it, not a longer if-chain.
  //
  // This function used to fall through to `return result`, so a tool with no branch was handed to a
  // client UNSCRUBBED — while the header above says, in as many words, that a new client-reachable read
  // is scrubbed by default. The comment described the design and the code did the reverse.
  //
  // The disposition now lives in TOOL_SCOPES beside the tool's other policy flags, and an undeclared one
  // REFUSES. Loudly, and before any bytes move: a client seeing an empty result would believe it, which
  // is the quieter and worse of the two failures the issue weighs.
  const declared = TOOL_SCOPES[name]?.present ?? null;
  if (declared === null) throw new UndeclaredPresentation(name);

  // `project` — THE AUDIT CHAIN (owner ruling 2026-08-27). lib/audit-view.mjs holds the allowlist over
  // each result's structure and the prose transform; nothing about what travels is decided here.
  //
  // The four tools are accountSafe and NOT clientSafe, so a `user` (report-link) token never reaches this
  // branch — authorize() refuses it before dispatch. That is asserted rather than assumed: an unhandled
  // `project` tool falls to the refusal at the bottom of this function, exactly as an unhandled `scrub`
  // one does, so a future tool declared `project` without a branch here fails loudly instead of returning
  // its raw result to a client.
  if (declared === "project") {
    if (name === "get_run") return accountRun(result, { brandName: BRAND.name });
    if (name === "trace") return accountTrace(result);
    if (name === "decision_timeline") return accountTimeline(result, { brandName: BRAND.name });
    if (name === "get_finding") return accountFinding(result);
    if (name === "what_if_plan") return accountWhatIfPlan(result);
    if (name === "what_if_run") return accountWhatIfQueued(result);
    if (name === "what_if_result") return accountWhatIfResult(result);
    throw new UndeclaredPresentation(name);
  }
  if (declared !== "scrub") return result;   // `bounded` and `passthrough` are declared decisions

  if (!result || typeof result !== "object") return result;
  if (name === "read_artifact") {
    const out = { ...result };
    // a section body carries no front matter; the whole document does
    if (typeof out.text === "string") out.text = out.section ? scrubBody(out.text) : scrubMarkdown(out.text);
    if (out.frontMatter) out.frontMatter = scrubFrontMatter(out.frontMatter);
    return out;
  }
  // list_findings answers on TWO paths and they get different treatment. The curated cards path is
  // client-authored prose and takes the card rules alone. The RAW path — the audit trail itself, opened
  // to an account by the 2026-08-27 ruling and still refused to a report link — is model prose out of
  // audit.md, so it takes the card rules PLUS the body transform (lib/audit-view.mjs scrubBlocks).
  // Keyed on the RESULT's own `kind`, which the tool stamps "cards" on the group path: the alternative
  // is re-deriving the path from the args, and a chokepoint that re-guesses what the tool did is how the
  // two drift apart.
  if (name === "list_findings" && Array.isArray(result.items))
    return result.kind === "cards" ? { ...result, items: scrubCards(result.items) } : accountFindingList(result);
  if (name === "brief" && typeof result.brief === "string") return { ...result, brief: scrubBody(result.brief) };
  // Run listings: a failure `reason` is the engine's raw stack (absolute paths, module names, provider
  // error text — pipeline writes String(e?.stack ?? e)). The portal already refuses to hand that to a
  // client browser; the MCP must refuse for the same reason, or the connector becomes the softer door to
  // the same string. The client keeps what tells them something true — state, failedStage in product
  // vocabulary, and a stable sentence — and loses the trace. `url` and `agent` are internal routing.
  // search_runs was in this branch and could never fire: it is neither clientSafe nor accountSafe, so
  // authorize() refuses it for both CLIENT_KINDS before dispatch ever reaches here. A dead branch inside
  // a security chokepoint reads as coverage that is not there, so it is gone rather than kept "just in
  // case" — and if search_runs ever becomes client-reachable, the declaration above is what will refuse
  // it until somebody decides what it should show.
  if (name === "list_runs" && Array.isArray(result)) return result.map(sanitizeRunForClient);

  // Not reachable: `declared === "scrub"` and every scrub tool is handled above, which the registry test
  // asserts in both directions. Refusing rather than returning keeps the property true if that ever slips.
  throw new UndeclaredPresentation(name);
}

// ONE sentence, composed in lib/audit-view.mjs — get_run and decision_timeline hand a client the same
// words list_runs does when a run failed, because three doors telling a client three different things
// about one failure is the disagreement this file keeps catching elsewhere.
const CLIENT_FAILURE_NOTE = clientFailureNote(BRAND.name);
function sanitizeRunForClient(r) {
  if (!r || typeof r !== "object") return r;
  const { url: _u, agent: _a, ...rest } = r;
  return r.state === "failed" ? { ...rest, reason: CLIENT_FAILURE_NOTE, reasonRedacted: true } : { ...rest, reason: undefined };
}

// ---- GRANTS result filtering (INSTALL.md §8) -----------------------------------------------------
// Narrow enumeration results to an account-scoped session's grant. Exported for the unit test.
// Anything without a resolvable account (an intake rejection before any run exists, a pre-grants run)
// is dropped for scoped sessions — visible only to full grants.
export function filterByAccounts(scope, name, result) {
  if (!Array.isArray(scope?.accounts)) return result;
  // one status-scan per call builds runId → account for the array filters
  const accountOf = () => {
    const map = new Map();
    for (const r of enumerateRuns()) map.set(r.runId, runAccountKey(r));
    return map;
  };
  if (name === "list_profiles" && result && Array.isArray(result.clients))
    return { ...result, clients: result.clients.filter((c) => scope.accounts.includes(c.key)) };
  if ((name === "list_runs" || name === "search_runs") && Array.isArray(result)) {
    const map = accountOf();
    return result.filter((r) => {
      const id = r.runId ?? r.id ?? null;
      return id != null && accountVisible(scope, map.get(id) ?? null);
    });
  }
  // search_runs answers an OBJECT ({query, mode, scope, runsScanned, hits, truncated}) — the array
  // guard above never matched it, so scoped sessions saw EVERY hit — a real cross-account content
  // leak. Filter the hits by their run's account like the array shapes.
  if (name === "search_runs" && result && Array.isArray(result.hits)) {
    const map = accountOf();
    const hits = result.hits.filter((h) => {
      const id = h.runId ?? h.id ?? null;
      return id != null && accountVisible(scope, map.get(id) ?? null);
    });
    return { ...result, hits, ...(typeof result.count === "number" ? { count: hits.length } : {}) };
  }
  if (name === "list_outbox_events" && result && Array.isArray(result.events)) {
    const map = accountOf();
    const events = result.events.filter((ev) => ev.runId != null && accountVisible(scope, map.get(ev.runId) ?? null));
    return { ...result, events, count: events.length };
  }
  return result;
}

// READONLY_EXCLUDED / READONLY_TOOL_DEFS were DELETED 2026-08-03. They were kept "for any external
// importer" and there were none, tree-wide, including tests. They were also advisory-only next to a
// real gate — the visible-tool set is derived per-scope in attachHandlers (scope.visibleTools) — and an
// advisory copy of a security boundary is exactly the thing that drifts out of step with the boundary
// and then gets read as if it were one.

// Build a fresh Server with handlers attached, scoped. Default = trusted local stdio (ops, full set incl.
// what-if). The HTTP entrypoint passes a resolved {scope, local:false} per session: a user token → read-only
// + run-pinned; an ops token → reads + write verbs (what-if stays stdio-only); no token → internal read-all.
// `readonly:true` is still accepted (maps to the internal HTTP profile) so existing callers keep working.
export function makeServer({ scope = null, local = null, readonly = false } = {}) {
  const eff = scope ?? (readonly ? { kind: "internal", runId: null } : { kind: "ops", runId: null });
  const isLocal = local ?? !readonly;
  // A CLIENT principal's assistant is briefed with skills/clearotron-client/SKILL.md over MCP `instructions` — the
  // pack was previously a file no connecting client ever saw. Guidance only; never a substitute for the
  // authorize()/scrub gates. Staff and ops get no instructions (see lib/instructions.mjs).
  const server = new Server(
    { name: NS, version: "0.1.0" },
    // `prompts` is declared for every kind; promptsFor() returns [] for the audiences that get none, so
    // an ops client sees an empty list rather than a protocol error on a capability we did not announce.
    { capabilities: { tools: {}, resources: {}, prompts: {} }, instructions: instructionsFor(eff) },
  );
  attachHandlers(server, { scope: eff, local: isLocal });
  return server;
}

export { tools, TOOL_DEFS, NS, log };

// stdio bootstrap — ONLY when this file is executed directly, so importing it (from http-server.mjs / tests)
// does NOT start a stdio server. stdio is the trusted local surface and keeps the full tool set incl. what-if.
const isMain = isEntrypoint(import.meta.url);
if (isMain) {
  makeServer().connect(new StdioServerTransport())
    .then(() => log("ready — read-only interrogation + gated what-if over prelim runs"))
    .catch((e) => { log(`fatal: ${e?.stack ?? e}`); process.exit(1); });
}
