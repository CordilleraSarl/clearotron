#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// Standalone MCP server wrapping the signa CORE (pure node+fetch) so a `claude -p` process can
// call the register-search tools off-gateway. Pure glue: the core owns all logic. Auth = SIGNA_API_KEY
// (Bearer token); base = SIGNA_BASE_URL || the core's DEFAULT_BASE. Telemetry: the core writes
// CLEAROTRON_REGISTER_CALL_LOG / CLEAROTRON_REGISTER_RECORD_LOG (the SHARED register ledger — one provider
// runs at a time; took this vendor's name off it)
// keyed by the GATEWAY session key (tctx.sessionKey) — we thread the run's session key via
// CLEAROTRON_GATHER_SESSION_KEY so the $0 provider-usage diff still attributes calls to the run.
import { serve } from "./stdio-server.mjs";
import { doSearch, doRecordFetch, doEnumerate, doExecutePlan, DEFAULT_BASE } from "../../../providers/signa/src/core.js";
import { proposeSupplemental } from "./supplemental.mjs";
import { CAPABILITIES } from "../../../providers/signa/src/capabilities.js";

const API_KEY = process.env.SIGNA_API_KEY || "";
const BASE = process.env.SIGNA_BASE_URL || DEFAULT_BASE;
const tctx = (kind) => ({
  kind,
  agentId: process.env.CLEAROTRON_GATHER_AGENT || "clawdi",
  sessionKey: process.env.CLEAROTRON_GATHER_SESSION_KEY || "",   // run session key — telemetry attribution
  sessionId: process.env.CLEAROTRON_GATHER_SESSION_ID || "",
});
const passthrough = (r) => (r && typeof r === "object" ? (r.text ?? JSON.stringify(r)) : String(r));
const guard = (fn) => async (args) => {
  if (!API_KEY) return { isError: true, text: "ERROR: SIGNA_API_KEY not set — register-search unavailable." };
  return passthrough(await fn(args));
};

serve({
  name: "register", version: "0.1.0",
  tools: [
    {
      name: "register_search",
      description: "Search the Signa trademark index (POST /v1/trademarks); returns a normalized cursor-paginated list whose record_id is a synthetic /mark/<office>/<id> ref. `query` is required. TWO MATCH SHAPES, mutually exclusive — pass ONE: `strategies` (ranked: exact/phonetic/fuzzy/prefix, several per call) or `match` (deterministic: exact/starts_with/ends_with/contains, one per call). Sending both is rejected by the API. Filter with nice_classes[], offices[] (Signa office keys, e.g. uspto/euipo/wipo/ipi), status[] and owner (a text match on the owner name — it widens on a shorter string, so it is never proof of an entity's whole portfolio). total_hits is the register's own corpus total; it is null when the vendor could only approximate it, and null means UNKNOWN, never zero. Follow up with register_record_fetch for full detail.",
      inputSchema: { type: "object", required: ["query"], properties: {
        query: { type: "string" },
        strategies: { type: "array", items: { type: "string" }, description: "RANKED match strategies, e.g. ['exact','fuzzy'] (default ['exact']). Mutually exclusive with `match`." },
        match: { type: "string", enum: ["similar", "exact", "starts_with", "ends_with", "contains"], description: "DETERMINISTIC match mode — one per call, and it forbids `strategies`. `contains` is the unanchored substring sweep." },
        nice_classes: { type: "array", items: { type: "integer" } },
        offices: { type: "array", items: { type: "string" }, description: "Signa office keys, e.g. ['uspto','euipo','wipo','ipi']" },
        owner: { type: "string", description: "owner NAME text match (filters.owner_name); composes with `query` in the same request" },
        status: { type: "array", items: { type: "string" }, description: "status_primary values: pending | active | inactive | unknown" },
        limit: { type: "integer", minimum: 1, maximum: 100, description: "the API rejects anything over 100" },
        cursor: { type: "string", description: "pagination cursor from a prior response (next_cursor)" },
      } },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
      handler: guard((a) => doSearch(API_KEY, BASE, a, tctx("search"))),
    },
    {
      name: "register_record_fetch",
      description: "Fetch the full NORMALIZED detail record for one trademark by record_id (a synthetic /mark/<office>/<id> ref OR a raw Signa id, e.g. tm_019d1db7-…). The normalized record is persisted for the driver's citation-fidelity gate. Returns neutral fields (applicationNumber/registrationNumber/dates/statusClass/niceClasses/owner).",
      inputSchema: { type: "object", required: ["record_id"], properties: {
        record_id: { type: "string", description: "a /mark/<office>/<id> ref or a raw Signa id (tm_…)" },
      } },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
      handler: guard((a) => doRecordFetch(API_KEY, BASE, a, tctx("record_fetch"))),
    },
    // ── the two tools that make a Signa run code-driven ───────────────────────────────────
    //
    // This server mounted TWO tools. Every other register server mounts six to eight, and the two
    // missing ones are the two that matter: without an enumerate there is no completeness primitive —
    // no way to return "I paged this band to exhaustion" as distinct from "here is what I got" — and
    // without an execute-plan a seat has no choice but to page the register by hand.
    {
      name: "register_enumerate",
      description: "ENUMERATE a named band to COMPLETION — the completeness primitive. You choose the query (same fields as register_search); this tool owns the page loop and the screening, and CANNOT return a partial list. It returns ONE of two states: {state:'enumerated', total_hits, count, records[…screened]} when the whole band was retrieved; or {state:'incomplete', total_hits, fetched, sample, reason} when the band ran past the resource ceiling — a signal to escalate or to hand the crowd to judgment as a descriptor, NEVER a clean negative. total_hits is THE REGISTER'S OWN CORPUS TOTAL, not the rows returned — the count of everything matching, whether or not it was all fetched. It is null when the vendor would only approximate the figure, and null means UNKNOWN: never 0, and never a number inferred from the pages you saw. Screening is free here: the search row already carries status and classes, so no extra call is billed. Pagination is by CURSOR and the tool owns it; you never pass one.",
      inputSchema: { type: "object", required: ["query"], properties: {
        query: { type: "string" },
        strategies: { type: "array", items: { type: "string" }, description: "RANKED match strategies, e.g. ['exact','fuzzy'] (default ['exact']). Mutually exclusive with `match`." },
        match: { type: "string", enum: ["similar", "exact", "starts_with", "ends_with", "contains"], description: "DETERMINISTIC match mode — one per call, and it forbids `strategies`." },
        nice_classes: { type: "array", items: { type: "integer" } },
        offices: { type: "array", items: { type: "string" }, description: "Signa office keys, e.g. ['uspto','euipo','wipo','ipi','ukipo']" },
        owner: { type: "string", description: "owner NAME text match (filters.owner_name); composes with `query` in the same request" },
        status: { type: "array", items: { type: "string" }, description: "status_primary values: pending | active | inactive | unknown" },
        in_scope_classes: { type: "array", items: { type: "number" }, description: "the SCREENING scope — it decides which records are marked out-of-class, and never narrows the query itself" },
      } },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
      handler: guard((a) => doEnumerate(API_KEY, BASE, a, tctx("enumerate"))),
    },
    {
      name: "register_execute_plan",
      description: "Execute the run's FROZEN register plan (_driver/register-plan.json) for ONE axis in a single call: the tool runs every dictated entry itself (enumerating to completion) and WRITES the named band to output_path, each block stamped with its qid. MERGES with any existing band: your judgment-addition blocks (no qid) and other axes' blocks survive; this axis's dictated blocks are refreshed. Returns a compact summary {written, blocks, executed, preserved, skipped, states} — never the band content. Do NOT run dictated plan entries manually; use this call.",
      inputSchema: { type: "object", required: ["plan_path", "axis", "output_path"], properties: {
        plan_path: { type: "string", description: "Absolute path to the frozen _driver/register-plan.json" },
        axis: { type: "string", description: "The register axis to execute (e.g. primary-sweep)" },
        output_path: { type: "string", description: "Absolute path of the named band to write (register-units/<axis>-band.json)" },
      } },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
      handler: guard((a) => doExecutePlan({ apiKey: API_KEY, base: BASE }, a, tctx("execute_plan"))),
    },
    {
      name: "register_propose_supplemental",
      description: "PROPOSE judgment-addition register queries; CODE executes them and writes the band (the supplemental lane — you never run register coverage by hand and never author band blocks). Each proposal: {predicate: exact|default|wildcard|phonetic|owner, term OR terms[] (OR-stack, split anything wider than the plan bound), romanization, owner? (a mark-text proposal may add an owner SCOPE FIELD — the owner×term intersection, which composes in ONE request here), nice_classes (REQUIRED — an unscoped sweep is rejected), rationale?, term_literal?}. Terms must be MARK-SHAPED and agree with the predicate: an anchored `*` needs predicate:wildcard, and a label/prose string is rejected — supply the mark terms it stands for. THIS SOURCE HONOURS ALL FIVE PREDICATES, predicate:phonetic included — it is a native ranked strategy here, and `phonemeExpansion: false` in the contract withholds only the client-supplied VARIANT PREVIEW, which this tool never sends. TWO SHAPES IT CANNOT SERVE, and both DEFER rather than degrade: an INFIX wildcard (`*foo*`), where the prefix and suffix anchors are served and the infix pattern has no operator — `contains` would appear to serve it and would in fact search the asterisks; and predicate:default on a term under 3 characters, which the vendor refuses outright (HTTP 400 — loud, never a narrower set). A NON-LATIN term is fine here and is sent AS ITSELF — this index holds the characters (probed 2026-08-17 on the full-record script field; the 38-key search row carries no script field at all, which is how the first probe read as 'the index holds none'), so a romanisation is never substituted. An owner term is a TEXT MATCH, not an entity identifier: it WIDENS on a shorter string rather than failing to match, so an owner slice reads as 'marks whose owner name contains this', never as one entity's portfolio. The tool mints each proposal as a qid'd supplemental plan entry (deterministic qid), executes them through the same deterministic executor as the dictated plan, MERGES the results into the band at output_path, and returns per-qid results: {state, total_hits, count, term_counts?, reason?, records_preview[≤25]}. Iterate freely: propose → read counts → propose narrower; a count that comes back UNKNOWN is this vendor's 10000 saturation marker, which is neither a zero nor a total. A crowd result (state:incomplete) is a descriptor for judgment — never a clean.",
      inputSchema: { type: "object", required: ["axis", "output_path", "proposals"], properties: {
        axis: { type: "string", description: "The register axis these supplementals belong to (e.g. primary-sweep)" },
        output_path: { type: "string", description: "Absolute path of the named band to merge into (register-units/<axis>-band.json)" },
        proposals: { type: "array", minItems: 1, items: { type: "object", properties: {
          predicate: { type: "string", enum: ["exact", "default", "wildcard", "phonetic", "owner"] },
          term: { type: "string" }, terms: { type: "array", items: { type: "string" } },
          romanization: { type: "string", description: "The Latin-script form of a NON-LATIN term. On THIS source it is NOT used to rescue the slice — nativeScriptIndex is true, so the characters are sent as themselves and the romanisation is carried for the reader only." },
          owner: { type: "string", description: "OPTIONAL owner scope field on a MARK-TEXT proposal: the owner×term intersection, served by filters.owner_name in the same request. Not allowed on predicate:owner (there the owner name IS the term)." },
          nice_classes: { type: "array", items: {} },
          rationale: { type: "string" },
          term_literal: { type: "boolean", description: "TRUE only when the term genuinely IS the mark verbatim (a multi-word slogan mark, a mark carrying an anchored star) — it bypasses the term-shape lint. Never use it to push a label through." },
        } } },
      } },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
      handler: guard((a) => proposeSupplemental(a, tctx("propose_supplemental"), {
        executePlan: (params, t) => doExecutePlan({ apiKey: API_KEY, base: BASE }, params, t),
        capabilities: CAPABILITIES,
      })),
    },
  ],
});
