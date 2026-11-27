// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// RE-MINT THE CONNECTOR'S DECLARED ANSWER SHAPES — mcp-server/result-shapes.json, one entry per tool.
//
//   node scripts/mint-result-shapes.mjs            # report whether the file is current, change nothing
//   node scripts/mint-result-shapes.mjs --check    # ... and exit 1 if it is not
//   node scripts/mint-result-shapes.mjs --apply    # write it
//
// Each tool lists its shape as an `outputSchema` (mcp-server/lib/result-shapes.mjs), and the SDK's own client checks
// every answer against it, so a shape is a promise to every program built on the connector. This script is where the
// shapes are written; the JSON is what ships. Change a tool's answer, change its shape here, run --apply, and the diff
// of the JSON shows the change. mcp-server/test/a-read-tool-answers-in-the-shape-it-declares.test.mjs and its
// siblings call every tool and fail when an answer and its shape part.
//
// Every shape is self-contained (no $id, $schema, $ref, title or description), because the client compiles each one
// on its own and caches by $id. A field that means what a published report-data field means takes that field's own
// definition, copied whole from docs/report-data.
import { writeFileSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { RECEIPT_STATES, REFUSAL_KINDS } from "../driver/order-receipt.mjs";   // the states an order can be in, and the kinds of refusal, named once

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "mcp-server", "result-shapes.json");
// The published report-data schemas, read from this checkout.
const DOCS = join(ROOT, "docs", "report-data");
const RD = { clearance: JSON.parse(readFileSync(join(DOCS, "clearance-1.schema.json"), "utf8")), knockout: JSON.parse(readFileSync(join(DOCS, "knockout-1.schema.json"), "utf8")) };
const S = { type: "string" }, B = { type: "boolean" }, SN = { type: ["string", "null"] };
const refused = { type: "object", required: ["outcome", "reason"], additionalProperties: false,
  properties: { outcome: { const: "refused" }, reason: S } };
// The root is `type: "object"` with the forms beneath it: the protocol's listing refuses any other root, and a refused listing loses every tool.
const either = (...ok) => ({ type: "object", anyOf: [...ok, refused] });
const closed = (required, properties) => ({ type: "object", required, additionalProperties: false, properties });
const immediate = { type: ["object", "null"] };

const startRun = closed(["outcome", "ok", "id", "agent", "queue", "queued", "warnings", "queuePath", "queueWatched", "note"], {
  outcome: { const: "queued" }, ok: { const: true }, id: S, agent: S, queue: S, queued: { const: true }, classify: {},
  warnings: { type: "array", items: S }, queuePath: S, queueWatched: S, note: S });
// A RETRY IS THE ORDER IT REPEATS: the same account's order already filed under that reference, answered as it stands,
// with nothing written or counted (driver/order-receipt.mjs orderAlreadyFiled).
const ORDER_STATES = { enum: Object.keys(RECEIPT_STATES) };
// `reasonKind` says which check refused an order before any run (driver/order-receipt.mjs REFUSAL_KINDS), null otherwise.
const REFUSAL_KIND = { type: ["string", "null"], enum: [...REFUSAL_KINDS, null] };
const startRunExisting = closed(["outcome", "ok", "id", "existing", "state", "terminal", "runId", "reason", "reasonKind", "updatedAt"], {
  outcome: { const: "already-filed" }, ok: { const: true }, id: S, existing: { const: true }, state: ORDER_STATES, terminal: B,
  runId: SN, reason: SN, reasonKind: REFUSAL_KIND, updatedAt: SN });

const stopRun = [
  closed(["outcome", "ok", "action", "id", "note"], { outcome: { const: "dequeued" }, ok: { const: true }, action: { const: "dequeued" }, id: S, note: S }),
  closed(["outcome", "ok", "action", "id", "note"], { outcome: { const: "already-claimed" }, ok: { const: false }, action: { const: "already-claimed" }, id: S, note: S }),
  closed(["outcome", "ok", "action", "runId", "state", "note"], { outcome: { const: "noop" }, ok: { const: false }, action: { const: "noop" }, runId: S, state: SN, note: S }),
  closed(["outcome", "ok", "action", "runId", "state", "statusWritten", "note"], { outcome: { const: "cancelled" }, ok: { const: true }, action: { const: "cancelled" }, runId: S, state: { const: "cancelled" }, statusWritten: B, immediate, note: S }),
  closed(["outcome", "ok", "action", "runId", "requestedAt", "note"], { outcome: { const: "already-stopping" }, ok: { const: true }, action: { const: "already-stopping" }, runId: S, requestedAt: SN, immediate, note: S }),
  closed(["outcome", "ok", "action", "runId", "requestedAt", "note"], { outcome: { const: "cancel-requested" }, ok: { const: true }, action: { const: "cancel-requested" }, runId: S, requestedAt: SN, immediate, note: S }),
];

const feedContext = closed(["outcome", "ok", "runId", "wrote", "note"], {
  outcome: { const: "written" }, ok: { const: true }, runId: S, wrote: { type: "array", items: S, minItems: 1 }, note: S });

const markSent = closed(["outcome", "ok", "runId", "alreadySent", "note"], {
  outcome: { enum: ["marked-sent", "already-sent"] }, ok: { const: true }, runId: S, alreadySent: B, note: S });

const ackEvent = closed(["outcome", "ok", "file", "alreadyGone"], {
  outcome: { enum: ["acknowledged", "already-gone"] }, ok: { const: true }, file: S, alreadyGone: B });

// what_if_run: queued (account), completed or failed (ops). The ops results carry the experiment's own fields.
const queuedFields = { queued: { const: true }, runId: S, experimentId: S, stage: SN, axis: SN, queuedAt: S, next: S };
const whatIfQueuedClient = closed(["outcome", "queued", "runId", "experimentId", "queuedAt", "next"], { outcome: { const: "queued" }, ...queuedFields });
const whatIfRan = (outcome, ok) => ({ type: "object", required: ["outcome", "ok"], properties: { outcome: { const: outcome }, ok: { const: ok } } });

// ── THE READ TOOLS ─────────────────────────────────────────────────────────────────────────────────────────
// CLOSED where the connector builds the object as a literal, so its keys are the code's; OPEN, with only the
// identifying keys required, where the object carries what a run's files or log hold. A leaf is its type or null
// unless the code guarantees it. A list answer goes out under `items`.
const N = (ty) => ({ type: [ty, "null"] });
const A = { type: "array" }, O = { type: "object" }, NUM = { type: "number" }, ANY = {};
const open = (required, properties = {}) => ({ type: "object", required, properties });
const items = (row) => closed(["items"], { items: { type: "array", items: row } });
const channel = closed(["sent", "messageId", "sentAt"], { sent: B, messageId: N("string"), sentAt: N("string") });
const runRowProps = {
  demo: S, runId: S, slug: SN, codename: SN, date: SN, agent: SN,
  client: closed(["key", "name"], { key: SN, name: SN, known: { const: false }, note: S }),
  project: { anyOf: [{ type: "null" }, closed(["key", "name"], { key: S, name: SN })] },
  product: SN, state: S, location: S, tier: SN, caption: SN, url: SN, markName: SN, ref: ANY, classes: ANY, step: SN,
  startedAt: SN, updatedAt: SN, deliveredAt: SN, failedStage: SN, reason: ANY,
  resetsAt: SN, recoveryResumesAt: SN, parkedKind: SN, terminalKind: SN, sendPending: B, sent: B,
  channels: closed(["email", "whatsapp"], { email: channel, whatsapp: channel }),
};
const RUN_ROW_REQUIRED = ["runId", "slug", "codename", "date", "agent", "client", "project", "product", "state", "location", "tier", "caption",
  "url", "markName", "ref", "classes", "step", "startedAt", "updatedAt", "deliveredAt", "failedStage", "reason", "resetsAt",
  "recoveryResumesAt", "parkedKind", "terminalKind", "sendPending", "sent", "channels"];
const staffRunRow = closed(RUN_ROW_REQUIRED, runRowProps);
// The client cut (server.mjs sanitizeRunForClient): no `url`, no `agent`; a failed run's reason is the firm's note.
const { url: _u, agent: _a, ...clientRowProps } = runRowProps;
const clientRunRow = closed(RUN_ROW_REQUIRED.filter((k) => !["url", "agent", "reason"].includes(k)), { ...clientRowProps, reason: S, reasonRedacted: { const: true } });

const orderFound = (extra) => closed(["found", "reference", "state", "terminal", "runId", "reason", "reasonKind", "updatedAt", ...Object.keys(extra)],
  { found: { const: true }, reference: S, state: ORDER_STATES, terminal: B, runId: SN, reason: SN, reasonKind: REFUSAL_KIND, updatedAt: SN, ...extra });
const orderNotFound = closed(["found", "basis"], { found: { const: false }, basis: { enum: ["not-found", "invalid-reference", "could-not-look", "ambiguous"] } });

const reads = {
  server_info: { all: closed(["name", "version", "commit", "sourceRepo", "sourceUrl", "license", "copyright"],
    { name: S, version: SN, commit: SN, sourceRepo: S, sourceUrl: S, license: S, copyright: S }) },
  list_runs: { staff: items(staffRunRow), client: items(clientRunRow) },
  // What became of one order (driver/order-receipt.mjs). The operator's answer names the account it belongs to and why it
  // was refused or stopped; a client's names neither, and says which check refused an order as `reasonKind` only.
  order_status: { staff: { type: "object", anyOf: [orderFound({ account: SN, organisation: SN }), orderNotFound] },
    client: { type: "object", anyOf: [orderFound({}), orderNotFound] } },
  list_profiles: { all: closed(["_note", "clients", "genericFallback"], { _note: S, clients: { type: "array", items: O }, genericFallback: S, storeUnreadable: S, unreadable: A }) },
  get_run: {
    staff: closed(["run", "stages", "failover", "artifacts", "coverageSummary"], { run: staffRunRow, product: { const: "knockout" }, stages: A, failover: A, artifacts: A, coverageSummary: O }),
    client: closed(["run", "stages", "failover", "artifacts", "coverageSummary"], { run: O, stages: A, failover: A, artifacts: A, coverageSummary: N("object") }),
  },
  read_artifact: { all: open(["name"], { _note: S, name: S, file: S, text: S, frontMatter: O, exists: B }) },
  trace: { all: open(["runId", "target"], { runId: S, target: S }) },
  get_telemetry: { all: closed(["runId", "stage", "runEvents", "attempts", "providerUsage"], { runId: S, stage: SN, runEvents: A, attempts: A, providerUsage: N("object") }) },
  get_provider_usage: { all: closed(["runId", "prefix", "live", "cached", "drift", "driftKeys", "comparedCounters", "ledgerStale", "lowConfidence", "note"],
    { runId: S, prefix: S, live: O, cached: N("object"), drift: N("boolean"), driftKeys: A, comparedCounters: A, ledgerStale: B, lowConfidence: B, note: S }) },
  get_coverage: { all: closed(["coverageLedgerPresent", "registerAxes", "findings", "negativeResults", "artifacts", "complete", "note"],
    { coverageLedgerPresent: B, registerAxes: A, findings: NUM, negativeResults: NUM, artifacts: A, complete: B, note: S }) },
  search: { all: closed(["runId", "query", "mode", "hits", "truncated"], { runId: S, query: S, mode: S, hits: A, truncated: B }) },
  decision_timeline: {
    staff: closed(["runId", "state", "tier", "verdictHistory", "timeline", "riskLadderAvailable", "note"],
      { runId: S, state: SN, tier: SN, verdictHistory: A, timeline: A, riskLadderAvailable: B, note: S }),
    client: open(["runId", "timeline"], { runId: S, state: SN, tier: SN, timeline: A, verdictHistory: A }),
  },
  run_changes: { all: closed(["runId", "state", "tier", "since", "cursor", "count", "changes", "note"],
    { runId: S, state: SN, tier: SN, since: SN, cursor: ANY, count: NUM, changes: A, note: S }) },
  diff_artifact: { all: { type: "object", anyOf: [
    closed(["runId", "name", "stage", "axis", "a", "b", "identical", "diff", "snapshotsAvailable", "note"],
      { runId: S, name: S, stage: S, axis: SN, a: ANY, b: ANY, identical: { type: "null" }, diff: { type: "null" }, snapshotsAvailable: ANY, note: S }),
    closed(["runId", "name", "stage", "axis", "a", "b", "identical", "diff", "snapshotsAvailable"],
      { runId: S, name: S, stage: S, axis: SN, a: ANY, b: ANY, identical: B, diff: S, telemetryDelta: ANY, snapshotsAvailable: ANY }),
  ] } },
  search_runs: { all: closed(["query", "mode", "scope", "runsScanned", "hits", "truncated"], { query: S, mode: S, scope: S, runsScanned: NUM, hits: A, truncated: B }) },
  what_if_plan: { all: open(["runnable"], { runnable: B }) },
  what_if_result: { all: open(["runId"], { runId: S }) },
  list_outbox_events: { all: closed(["ok", "count", "events"], { ok: { const: true }, count: NUM, events: { type: "array", items: O } }) },
  get_delivery_packet: { all: closed(["ok", "runId", "state", "sendPending", "sent", "delivery", "failure"],
    { ok: { const: true }, runId: S, state: SN, sendPending: N("boolean"), sent: B, delivery: N("object"), failure: N("object") }) },
};

// ── THE REPORT READERS: a field that means what report-data's published field means takes report-data's own
// definition, copied whole so each shape stands alone for an offline client; the test holds each copy equal to the
// published one. Everything else is declared from the connector's own projection.
const rdKo = (field) => RD.knockout.$defs.webFinding.properties[field];
const findingItem = { type: "object", properties: {
  name: rdKo("name"), owner: rdKo("owner"), band: rdKo("band"), type: rdKo("type"), net: rdKo("net"), basis: rdKo("basis"), evidence: rdKo("evidence"),
} };
const DOC = N("string");   // the report document version the answer was read from, or null where it read the run's files
const reports = {
  brief: { all: closed(["_note", "runId", "markName", "product", "overall", "tier", "caption", "state", "date", "source", "brief", "document"],
    { _note: S, runId: S, markName: SN, product: SN, overall: SN, tier: SN, caption: RD.clearance.properties.caption, state: SN, date: SN, source: S, brief: S, document: DOC }) },
  list_findings: { all: open(["_note", "kind", "items", "document"],
    { _note: S, kind: S, items: { type: "array", items: findingItem }, source: S, group: S, available: B, product: SN, note: S, document: DOC }) },
  get_finding: { all: open(["id", "document"], { id: S, document: DOC, ...findingItem.properties }) },
  list_evidence: { all: closed(["source", "records", "document"], { source: S, records: { type: "array", items: O }, document: DOC }) },
  list_searches: { all: open(["count", "searches", "document"], { count: NUM, searches: { type: "array", items: O }, totalCount: NUM, source: S, document: DOC }) },
  get_search_coverage: { all: open(["areas", "document"], { areas: { type: "array", items: O }, note: S, source: S, document: DOC }) },
};

// ── THE TWO PRE-ORDER TOOLS: one answer for every kind of session, each built in one place (lib/plan.mjs planRun,
// lib/options.mjs describeOptions). The top level is closed; a block that describes the order names its keys and
// stays open, and How soon (the order option this release adds) is closed throughout.
const strings = { type: "array", items: S };
const howSoonOption = { type: ["object", "null"], required: ["turnaround", "turnaroundLowHours", "turnaroundHighHours", "searches", "withinAllowance"],
  additionalProperties: false, properties: { turnaround: S, turnaroundLowHours: NUM, turnaroundHighHours: NUM, searches: NUM, withinAllowance: N("boolean") } };
const planRun = closed(["ok", "wouldRun", "_note", "blockers", "warnings", "caveat", "search", "subject", "scope", "effort", "howSoon", "account"], {
  ok: B, wouldRun: B, _note: S, blockers: strings, warnings: strings, caveat: S,
  search: open(["name", "product", "pipeline", "components", "savedSearch", "turnaround", "maxNames", "caseLaw", "nativeLanguage", "chosenBy", "registerReach"],
    { name: SN, product: SN, pipeline: SN, components: N("object"), savedSearch: N("object"), turnaround: SN, maxNames: N("number"), caseLaw: B,
      nativeLanguage: SN, chosenBy: S, registerReach: N("object") }),
  subject: open(["marks", "markCount", "classes", "classesFrom", "goods"], { marks: strings, markCount: NUM, classes: A, classesFrom: S, goods: SN }),
  scope: open(["jurisdictions", "jurisdictionsFrom", "bindingLayers", "platforms", "platformsAdded", "platformsFrom", "gridCellsPerVariant"],
    { jurisdictions: A, jurisdictionsFrom: S, bindingLayers: A, platforms: A, platformsAdded: A, platformsFrom: S, gridCellsPerVariant: N("number") }),
  effort: N("object"),
  howSoon: closed(["chosen", "urgentAvailable", "standard", "urgent"],
    { chosen: { enum: ["standard", "urgent"] }, urgentAvailable: B, urgentNote: S, standard: howSoonOption, urgent: howSoonOption }),
  account: open(["profileKey", "name", "projectKey", "framework", "caps", "usage", "usageComplete", "dailyRunsEffective", "remainingToday", "allowanceApplies", "origins"],
    { profileKey: SN, name: SN, projectKey: SN, framework: S, caps: N("object"), usage: N("object"), usageComplete: N("boolean"), dailyRunsEffective: N("number"),
      remainingToday: N("number"), allowanceApplies: N("boolean"), origins: N("object") }),
});
const describeOptions = closed(["_note", "products", "scopeRules", "urgent", "account"], {
  _note: S, products: { type: "array", items: open(["key", "name", "available"], { key: S, name: S, available: B }) },
  registerTerritories: N("array"), scopeRules: O,
  urgent: closed(["available"], { available: B, note: S }),
  account: { type: ["object", "null"], required: ["profileKey"], properties: { profileKey: S, name: SN, projects: A, defaults: O, savedSearches: A, savedSearchesNote: SN, allowance: N("object") } },
  accountsGranted: { type: "array", items: closed(["profileKey", "name"], { profileKey: S, name: SN }) },
  accountNote: S,
});
const preOrder = { plan_run: { all: planRun }, describe_options: { all: describeOptions } };

const shapes = {
  start_run: { all: either(startRun, startRunExisting) },
  stop_run: { all: either(...stopRun) },
  feed_context: { all: either(feedContext) },
  mark_sent: { all: either(markSent) },
  ack_event: { all: either(ackEvent) },
  what_if_run: { staff: either(whatIfRan("completed", true), whatIfRan("failed", false)), client: either(whatIfQueuedClient) },
  ...reads,
  ...reports,
  ...preOrder,
};

const minted = JSON.stringify(shapes, null, 2) + "\n";
let onDisk = null;
try { onDisk = readFileSync(OUT, "utf8"); } catch { /* absent: stale */ }
const current = onDisk === minted;
if (process.argv.includes("--apply")) {
  if (!current) writeFileSync(OUT, minted);
  console.log(`mint-result-shapes: ${current ? "already current" : "wrote"} ${Object.keys(shapes).length} tools`);
  process.exit(0);
}
console.log(`mint-result-shapes: ${Object.keys(shapes).length} tools; mcp-server/result-shapes.json is ${current ? "current" : "STALE: run node scripts/mint-result-shapes.mjs --apply"}`);
process.exit(process.argv.includes("--check") && !current ? 1 : 0);
