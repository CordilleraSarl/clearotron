#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// Standalone MCP server wrapping the clarivate CORE (pure node+fetch) so a `claude -p` process can
// call the register-search tools off-gateway. Pure glue: the core owns all logic. Auth = CLARIVATE_API_KEY
// (X-ApiKey header); base = CLARIVATE_API_BASE || the core's DEFAULT_BASE. Telemetry: the core writes
// CLEAROTRON_REGISTER_CALL_LOG / CLEAROTRON_REGISTER_RECORD_LOG (the SHARED register ledger — one provider
// runs at a time; took this vendor's name off it)
// keyed by the GATEWAY session key (tctx.sessionKey) — we thread the run's session key via
// CLEAROTRON_GATHER_SESSION_KEY so the $0 provider-usage diff still attributes calls to the run.
//
// ── The tool set is the NEUTRAL register_* contract, minus exactly one tool ────────────────────────
// This server exposes 7 of the 8 names in gather-config's REGISTER_TOOLS. The eighth,
// `register_expand_phoneme`, is NOT REGISTERED and is deliberately NOT stubbed:
//
//   Compumark Content's phonetic surface is the PHONETIC_WORD_MARK_SPECIFICATION field — opaque,
//   server-side, with no variant list to preview. The surface that WOULD expand a phoneme into ranked
//   variants (/similarity/word/*) is not available on this provider: the endpoint answers HTTP 403,
//   confirmed on 2026-07-21 with a schema-correct body.
//
// Doctrine 2: a capability the provider genuinely lacks FAILS LOUDLY and becomes a `deferred` coverage
// row. It must never quietly degrade into a weaker query under the right tool name — handing back, say,
// the seed word as its own "variant" would be a different search wearing the right answer's clothes.
// The absence is made VISIBLE in three places rather than left silent:
//   1. here, in the tool list a spawn actually sees (the name simply is not offered);
//   2. providers/clarivate/src/capabilities.js — `phonemeExpansion: false`, the machine-readable claim;
//   3. driver/test/engine.gather.test.mjs — a test pins this server's exact 7 names AND cross-checks
//      them against that capability flag, so flipping the contract without wiring a tool fails CI.
// `match_mode: "phonetic"` on register_search / register_enumerate remains fully available; it is the
// PREVIEW of the expansion that this provider cannot give, not phonetic search itself.
import { serve } from "./stdio-server.mjs";
import {
  CAPABILITIES, doSearch, doRecordFetch, doImageFetch, doBatchScreen, doEnumerate, doExecutePlan, DEFAULT_BASE,
} from "../../../providers/clarivate/src/core.js";
import { proposeSupplemental } from "./supplemental.mjs";

const API_KEY = process.env.CLARIVATE_API_KEY || "";
const BASE = process.env.CLARIVATE_API_BASE || DEFAULT_BASE;
const tctx = (kind) => ({
  kind,
  agentId: process.env.CLEAROTRON_GATHER_AGENT || "clawdi",
  sessionKey: process.env.CLEAROTRON_GATHER_SESSION_KEY || "",   // run session key — telemetry attribution
  sessionId: process.env.CLEAROTRON_GATHER_SESSION_ID || "",
});
const passthrough = (r) => (r && typeof r === "object" ? (r.text ?? JSON.stringify(r)) : String(r));
const guard = (fn) => async (args) => {
  if (!API_KEY) return { isError: true, text: "ERROR: CLARIVATE_API_KEY not set — register-search unavailable." };
  return passthrough(await fn(args));
};

// The query fields every mark-side tool accepts (search + enumerate share one vocabulary).
const QUERY_PROPS = {
  query: { type: "string" }, name: { type: "string" }, names: { type: "array", items: { type: "string" } },
  owner: { type: "string" }, owners: { type: "array", items: { type: "string" } }, representative: { type: "string" },
  match_mode: { type: "string", enum: ["default", "exact", "phonetic", "wildcard", "starts_with", "ends_with", "contains"] },
  regions: { type: "array", items: { type: "string" }, description: "registrationOfficeCodes, e.g. ['US','EM','WO'] — at least one required (EU is translated to EM for you)" },
  nice_classes: { type: "array", items: { type: "integer" } },
  active_only: { type: "boolean" }, plurals: { type: "boolean" }, cross_references: { type: "boolean" },
  limit_wo_to_designated: { type: "boolean", description: "restrict International (WO) marks to those designated in the other regions; defaults on for a jurisdiction-scoped sweep that includes WO" },
  resolve_owner: { type: "boolean", description: "enumerate only: resolve an owner term to exact applicant names first (default true)" },
};

serve({
  name: "register", version: "0.2.0",
  tools: [
    {
      name: "register_search",
      description: "Search the register index; returns the COMPLETE set of matching records (this provider has no pagination — one call, the whole guid set) whose record_id is a synthetic /mark/<office>/<guid> ref. Provide at least one element (query/name/names, owner/owners, representative) and regions[] (required). match_mode: default (a TRUE contains)|exact|phonetic (native sound-alike; no variant preview exists on this provider)|wildcard (pass * and ? through natively)|starts_with|ends_with. Multiple nice_classes cost ONE call (they become an OR-list). A term containing OR/AND/NOT or parentheses is REJECTED rather than silently re-parsed as an operator. Past 30000 hits the provider fails loud — use register_enumerate, which probes the count first. Follow up with register_record_fetch for full detail.",
      inputSchema: { type: "object", required: ["regions"], properties: {
        ...QUERY_PROPS,
        raw_pagination: { type: "object", description: "advanced passthrough merged into the /search body" },
      } },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
      handler: guard((a) => doSearch(API_KEY, BASE, a, tctx("search"))),
    },
    {
      name: "register_enumerate",
      description: "ENUMERATE a named band to COMPLETION — the completeness primitive. You choose the query (same fields as register_search); this tool owns the count probe, the OR-stack chunking and the screening, and CANNOT return a partial list. It returns ONE of two states: {state:'enumerated', total_hits, count, records[…batch-screened]} when the whole band was retrieved (every named record, already screened with class/status/owner/screen_verdict); or {state:'incomplete', total_hits, fetched, sample, reason} when the band is a CROWD (over the resource ceiling or over the provider's 30000-result hard ceiling) or a provider error occurred — a signal to escalate (narrow the query to the named band and re-enumerate, or hand the crowd to judgment as a descriptor), NEVER a clean negative. On a crowd this provider also returns per_office_counts: the jurisdictional SHAPE of the crowd, from the same cheap count probe. An owner term is resolved to exact applicant names first (resolve_owner:false opts out). Use this for the dangerous named band (the exact mark + each specific variant, in-scope classes, per jurisdiction).",
      inputSchema: { type: "object", required: ["regions"], properties: {
        ...QUERY_PROPS,
        in_scope_classes: { type: "array", items: { type: "number" } },
      } },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
      handler: guard((a) => doEnumerate(API_KEY, BASE, a, tctx("enumerate"))),
    },
    {
      name: "register_record_fetch",
      description: "Fetch the full NORMALIZED detail record(s) for one or more trademarks by record_id (a synthetic /mark/<office>/<guid> ref OR a bare guid). Batched at EXACTLY 100 ids per call; each normalized record is persisted for the driver's citation-fidelity gate. Returns { count, records[…] } with neutral fields (applicationNumber/registrationNumber/dates/statusClass/niceClasses/owner/seniorities/priorities/madridDesignations). Opposition data is NOT AVAILABLE from this provider (oppositions:null) — never report that as 'none found'.",
      inputSchema: { type: "object", required: ["record_ids"], properties: {
        record_ids: { type: "array", items: { type: "string" }, minItems: 1, description: "refs (/mark/<office>/<guid>) or bare guids" },
        test_mode: { type: "boolean", default: false, description: "request test/obfuscated bodies — NOT persisted, can never back a real finding (dev only)" },
      } },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
      handler: guard((a) => doRecordFetch(API_KEY, BASE, a, tctx("record_fetch"))),
    },
    {
      name: "register_batch_screen",
      description: "Batch-hydrate SCREENING data for many record_ids in one call, chunked at 100/call. Per row: classes/status/owner/dates/jurisdictions/markFeatures + computed live_status, all_class, and a closed-set screen_verdict (the SAME verdict vocabulary every register provider uses). Pass in_scope_classes. NEVER drop a surface:* / deepfetch:* row on a guess without a record_fetch.",
      inputSchema: { type: "object", required: ["uris"], properties: {
        uris: { type: "array", items: { type: "string" }, minItems: 1, description: "refs (/mark/<office>/<guid>) or bare guids" },
        in_scope_classes: { type: "array", items: { type: "number" } },
      } },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
      handler: guard((a) => doBatchScreen(API_KEY, BASE, a, tctx("batch_screen"))),
    },
    {
      name: "register_image_fetch",
      description: "Fetch figurative-mark image metadata (content type + size, presence) for one or more record_ids (synthetic refs or bare guids). Returns a per-guid summary; defaults to test_mode (set test_mode:false for the live image). Only invoke for records whose detail says an image is available.",
      inputSchema: { type: "object", required: ["record_ids"], properties: {
        record_ids: { type: "array", items: { type: "string" }, minItems: 1, description: "refs (/mark/<office>/<guid>) or bare guids" },
        test_mode: { type: "boolean", default: true, description: "use test images (default); false = the live image" },
      } },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
      handler: guard((a) => doImageFetch(API_KEY, BASE, a, tctx("image"))),
    },
    {
      name: "register_execute_plan",
      description: "Execute the run's FROZEN register plan (_driver/register-plan.json) for ONE axis in a single call: the tool runs every dictated entry itself (enumerates to completion; count entries stay count-only crowd descriptors; a when-guarded fringe runs only if its parent slice enumerated) and WRITES the named band to output_path itself, each block stamped with its qid. MERGES with any existing band: your judgment-addition blocks (no qid) and other axes' blocks survive; this axis's dictated blocks are refreshed. Returns a compact summary {written, blocks, executed, preserved, skipped, states} — never the band content. Do NOT run dictated plan entries manually; use this call, then add judgment extras via register_propose_supplemental.",
      inputSchema: { type: "object", required: ["plan_path", "axis", "output_path"], properties: {
        plan_path: { type: "string", description: "Absolute path to the frozen _driver/register-plan.json" },
        axis: { type: "string", description: "The register axis to execute (e.g. primary-sweep)" },
        output_path: { type: "string", description: "Absolute path of the named band to write (register-units/<axis>-band.json)" },
      } },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
      handler: guard((a) => doExecutePlan(API_KEY, BASE, a, tctx("execute_plan"))),
    },
    {
      name: "register_propose_supplemental",
      description: "PROPOSE judgment-addition register queries; CODE executes them and writes the band (the supplemental lane — you never run register coverage by hand and never author band blocks). Each proposal: {predicate: exact|default|wildcard|phonetic|owner, term OR terms[] (OR-stack, split anything wider than the plan bound), romanization (MANDATORY beside a single non-Latin term — this register indexes non-Latin filings by their transliteration and refuses bare characters), owner? (a mark-text proposal may add an owner SCOPE FIELD — the owner×term intersection slice, the watchlist-coverage move), nice_classes (REQUIRED — an unscoped sweep is rejected), regions?, rationale?, term_literal? (true asserts the term IS a mark verbatim, bypassing the shape lint)}. Terms must be MARK-SHAPED and agree with the predicate: an anchored `*` needs predicate:wildcard, and a label/prose string (>4 words, parentheticals) is rejected — supply the mark terms it stands for. The tool mints each proposal as a qid'd supplemental plan entry (deterministic qid — re-proposing the same query reuses it, never duplicates; re-proposing a bare non-Latin term WITH its romanization enriches the existing entry and re-executes it), executes them through the same deterministic executor as the dictated plan (count-first per-term truth, ceiling, chunking, error stamping), MERGES the results into the band at output_path itself, and returns per-qid results read back from the band: {state, total_hits, count, term_counts?, reason?, records_preview[≤25]}. Iterate freely: propose → read counts → propose narrower. A crowd result (state:incomplete) is a descriptor for judgment — never a clean.",
      inputSchema: { type: "object", required: ["axis", "output_path", "proposals"], properties: {
        axis: { type: "string", description: "The register axis these supplementals belong to (e.g. primary-sweep)" },
        output_path: { type: "string", description: "Absolute path of the named band to merge into (register-units/<axis>-band.json)" },
        proposals: { type: "array", minItems: 1, items: { type: "object", properties: {
          predicate: { type: "string", enum: ["exact", "default", "wildcard", "phonetic", "owner"] },
          term: { type: "string" }, terms: { type: "array", items: { type: "string" } },
          romanization: { type: "string", description: "The Latin-script form of a NON-LATIN term — plain ASCII letters/digits, syllable-separated by single spaces, no tone marks or diacritics (华威豹 → \"HUA WEI BAO\", ティキスラッシュ → \"TIKI SURASSHU\"). MANDATORY beside a non-Latin term: without it this register cannot answer the characters and the slice defers. Single-term proposals only (never an OR-stack, never predicate:owner), and never on a term that is already Latin." },
          owner: { type: "string", description: "OPTIONAL owner scope field on a MARK-TEXT proposal: the query is the owner×term intersection (the owner's filings within the term band). Not allowed on predicate:owner (there the owner name IS the term)." },
          nice_classes: { type: "array", items: {} },
          regions: { type: "array", items: { type: "string" },
            description: "OPTIONAL. Omit to inherit the frozen plan's regions (the matter's territorial scope) — this provider REQUIRES at least one office on every request, so an omitted list is backfilled from the plan, never treated as a worldwide sweep. Supply it only to search a NARROWER set than the matter's scope." },
          rationale: { type: "string" },
          term_literal: { type: "boolean", description: "TRUE only when the term genuinely IS the mark verbatim (a multi-word slogan mark, a mark carrying an anchored star) — it bypasses the term-shape lint. Never use it to push a label through." },
        } } },
      } },
      // ARITY: proposeSupplemental calls executePlan(auth, params, tctx) — THREE args, because corsearch's
      // doExecutePlan is (sessionKey, params, tctx). Clarivate's is (apiKey, base, params, tctx), so the
      // injected executor MUST close over BASE here. Passing doExecutePlan bare would shift base←params
      // and send every supplemental at a URL built from the params object.
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
      handler: guard((a) => proposeSupplemental(a, tctx("propose_supplemental"), {
        executePlan: (params, t) => doExecutePlan(API_KEY, BASE, params, t),
        capabilities: CAPABILITIES,
      })),
    },
  ],
});
