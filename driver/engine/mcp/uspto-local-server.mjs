#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// Standalone MCP server wrapping the uspto-local CORE (node:sqlite, no network) so a `claude -p`
// process can call the register-search tools off-gateway. Pure glue: the core owns all logic.
//
// ── THERE IS NO CREDENTIAL, AND THAT IS THE INTERESTING PART ──────────────────────────────────────
// Every other register server guards on an API key. This one has none to guard on: the register is a
// FILE, and `USPTO_LOCAL_DB` names it. The guard is therefore about the INDEX, not about auth, and it
// must stay just as loud — an unset path, a path to nothing, or a database carrying the schema and no
// rows all produce the same downstream lie if they are allowed through, which is a search that returns
// zero over a register nobody ever downloaded. `openFor` asserts the row count for exactly that
// reason; this guard catches the unset case one step earlier so the message names the variable.
//
// Telemetry: the core writes CLEAROTRON_REGISTER_CALL_LOG / CLEAROTRON_REGISTER_RECORD_LOG (the SHARED register ledger —
// one provider runs at a time) keyed by the GATEWAY session key (tctx.sessionKey), threaded in via
// CLEAROTRON_GATHER_SESSION_KEY so the $0 provider-usage diff still attributes calls to the run. A local
// search costs nothing, which is precisely why it would otherwise go unrecorded and a run would read
// as having searched no register at all.
//
// ── SIX OF THE EIGHT NEUTRAL NAMES; TWO ARE ABSENT ON PURPOSE ─────────────────────────────────────
// `register_image_fetch` — the bulk product this index is built from is TEXT. It carries the drawing
//   CODE (word / design / combined, which is why `mark_feature` is populated) but not one byte of
//   image data. There is no weaker version of an image to serve, so nothing is stubbed.
// `register_expand_phoneme` — no phonetic surface exists over a plain text column, and
//   capabilities.phonemeExpansion is false. Unlike clarivate, phonetic SEARCH is unavailable here too:
//   capabilities.predicates.phonetic is null, so the planner stamps the slice `unsupported` and it
//   surfaces as a deferred coverage row.
//
// Doctrine 2 in both cases: a capability the provider genuinely lacks fails LOUDLY and is disclosed;
// it never quietly degrades into a weaker query wearing the right tool's name. The absence is made
// visible where a spawn and a reviewer each actually look — the tool list here, the REGISTER_SERVERS
// filter in gather-config.mjs, and the exact-six pin in driver/test/engine.gather.test.mjs.
import { serve } from "./stdio-server.mjs";
import {
  CAPABILITIES, DEFAULT_DB_ENV, doSearch, doRecordFetch, doBatchScreen, doEnumerate, doExecutePlan,
} from "../../../providers/uspto-local/src/core.js";
import { proposeSupplemental } from "./supplemental.mjs";

const DB_PATH = process.env[DEFAULT_DB_ENV] || "";
// The auth object IS the index path — see the core's header. Passed as an object rather than a bare
// string so a future second knob (a read replica, a snapshot pin) does not change every call site.
const AUTH = { dbPath: DB_PATH };
const tctx = (kind) => ({
  kind,
  agentId: process.env.CLEAROTRON_GATHER_AGENT || "clawdi",
  sessionKey: process.env.CLEAROTRON_GATHER_SESSION_KEY || "",   // run session key — telemetry attribution
  sessionId: process.env.CLEAROTRON_GATHER_SESSION_ID || "",
});
const passthrough = (r) => (r && typeof r === "object" ? (r.text ?? JSON.stringify(r)) : String(r));
const guard = (fn) => async (args) => {
  if (!DB_PATH) {
    return { isError: true, text:
      `ERROR: ${DEFAULT_DB_ENV} not set — the local US register is unavailable. This provider searches a `
      + "file on disk, not a remote API: build the index with `node bin/uspto-sync.mjs` and point "
      + `${DEFAULT_DB_ENV} at it. Refusing rather than returning an empty result set, which would read `
      + "downstream as a clean US register." };
  }
  return passthrough(await fn(args));
};

// The query fields every mark-side tool accepts (search + enumerate share one vocabulary). No
// `regions`: this source holds ONE office. The plan's territorial scope is resolved against
// capabilities.offices.covered before a query is ever compiled, so anything but US is a deferred
// jurisdiction upstream — accepting a regions[] here would let a caller believe it had narrowed
// something, and silently searching the US either way is exactly the wrong-query-right-name failure.
const QUERY_PROPS = {
  name: { type: "string" }, names: { type: "array", items: { type: "string" }, description: "the OR stack; the plan caps it at 25 terms (capabilities.maxOrWidth) — never re-chunked here" },
  owner: { type: "string", description: "an owner substring. Alone it IS the query (predicate owner); alongside names it is a SCOPE field — the owner's filings within the term band." },
  predicate: { type: "string", enum: ["exact", "default", "wildcardPrefix", "wildcardSuffix", "wildcardInfix", "owner"],
    description: "default = an unanchored contains (a TRUE infix scan, not a token match). `phonetic` is absent: this index has no phonetic surface, so the slice defers rather than degrading." },
  nice_classes: { type: "array", items: { type: "integer" }, description: "Nice classes as bare numbers (9, not '009') — the index canonicalises both sides" },
  status: { type: "array", items: { type: "string" }, description: "USPTO status codes; omit for all filings. Screening classifies live/dead from the row, so filtering here is rarely what you want." },
};

serve({
  name: "register", version: "0.1.0",
  tools: [
    {
      name: "register_search",
      description: "Search the local US trademark index (a synced copy of the USPTO bulk register); returns a paginated normalized list whose record_id is a synthetic /mark/us/<serial> ref. Provide at least one element (name/names or owner) — an elementless search is REFUSED, never answered with the register. predicate: default (unanchored contains)|exact|wildcardPrefix|wildcardSuffix|wildcardInfix|owner. Multiple nice_classes cost ONE query (they are a column, not a fan-out). US only: this source holds one office, and any other jurisdiction is a deferred gap decided upstream at plan time. Paging is limit/offset. Follow up with register_record_fetch for full detail.",
      inputSchema: { type: "object", properties: {
        ...QUERY_PROPS,
        limit: { type: "integer", minimum: 1, maximum: 1000 },
        offset: { type: "integer", minimum: 0, description: "OFFSET, not a page number" },
      } },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
      handler: guard((a) => doSearch(AUTH, a, tctx("search"))),
    },
    {
      name: "register_enumerate",
      description: "ENUMERATE a named band to COMPLETION — the completeness primitive. You choose the query (same fields as register_search); this tool owns the count probe, the OR-stack chunking and the screening, and CANNOT return a partial list. It returns ONE of two states: {state:'enumerated', total_hits, count, records[…batch-screened]} when the whole band was retrieved (every named record, already screened with class/status/screen_verdict); or {state:'incomplete', total_hits, fetched, sample, reason} when the band is a CROWD over the resource ceiling, or the INDEX IS STALE — a signal to escalate (narrow the query and re-enumerate, or hand the crowd to judgment as a descriptor), NEVER a clean negative. Staleness matters here in a way it does not on a remote provider: this register is a local copy, and a copy older than 24 hours cannot support a clean negative, so the count refuses with total:null rather than answering 0. Use this for the dangerous named band (the exact mark + each specific variant, in-scope classes).",
      inputSchema: { type: "object", properties: {
        ...QUERY_PROPS,
        in_scope_classes: { type: "array", items: { type: "number" }, description: "the SCREENING scope — it decides which records are marked out-of-class, and never narrows the query itself" },
      } },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
      handler: guard((a) => doEnumerate(AUTH, a, tctx("enumerate"))),
    },
    {
      name: "register_record_fetch",
      description: "Fetch the full NORMALIZED detail record for one US trademark by record_id (a synthetic /mark/us/<serial> ref OR a bare serial number). The normalized record is persisted for the driver's citation-fidelity gate. Returns neutral fields (applicationNumber/registrationNumber/dates/statusClass/niceClasses/owner/goodsAndServices) plus a tsdr.uspto.gov link for the public record. Opposition and TTAB data are NOT in this index (oppositions:null, capabilities.oppositions false) — never report that absence as 'no oppositions found'.",
      inputSchema: { type: "object", required: ["record_id"], properties: {
        record_id: { type: "string", description: "a /mark/us/<serial> ref or a bare USPTO serial number" },
      } },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
      handler: guard((a) => doRecordFetch(AUTH, a, tctx("record_fetch"))),
    },
    {
      name: "register_batch_screen",
      description: "Batch-hydrate SCREENING data for many record_ids in one call. Per row: classes/status/owner/dates/mark_feature + computed live_status, all_class, and a closed-set screen_verdict (the SAME verdict vocabulary every register provider uses). Pass in_scope_classes. Every row read is also persisted for the fidelity gate, so a record surfaced from the band is citable without a second call. NEVER drop a surface:* / deepfetch:* row on a guess without a record_fetch.",
      inputSchema: { type: "object", required: ["uris"], properties: {
        uris: { type: "array", items: { type: "string" }, minItems: 1, description: "refs (/mark/us/<serial>) or bare serial numbers" },
        in_scope_classes: { type: "array", items: { type: "number" } },
      } },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
      handler: guard((a) => doBatchScreen(AUTH, a, tctx("batch_screen"))),
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
      handler: guard((a) => doExecutePlan(AUTH, a, tctx("execute_plan"))),
    },
    {
      name: "register_propose_supplemental",
      description: "PROPOSE judgment-addition register queries; CODE executes them and writes the band (the supplemental lane — you never run register coverage by hand and never author band blocks). Each proposal: {predicate: exact|default|wildcard|phonetic|owner, term OR terms[] (OR-stack, split anything wider than the plan bound), romanization (the Latin-script form of a non-Latin term), owner? (a mark-text proposal may add an owner SCOPE FIELD — the owner×term intersection slice), nice_classes (REQUIRED — an unscoped sweep is rejected), rationale?, term_literal? (true asserts the term IS a mark verbatim, bypassing the shape lint)}. Terms must be MARK-SHAPED and agree with the predicate: an anchored `*` needs predicate:wildcard, and a label/prose string (>4 words, parentheticals) is rejected — supply the mark terms it stands for. TWO PROPOSALS THIS SOURCE CANNOT HONOUR, and both DEFER rather than degrade: predicate:phonetic (no phonetic surface on a text index) and a non-Latin term (nativeScriptIndex is UNDECLARED — nobody has probed the tokenizer against real ingested data, and guessing would silently romanise). The tool mints each proposal as a qid'd supplemental plan entry (deterministic qid — re-proposing the same query reuses it, never duplicates), executes them through the same deterministic executor as the dictated plan (count-first per-term truth, ceiling, chunking, error stamping), MERGES the results into the band at output_path itself, and returns per-qid results read back from the band: {state, total_hits, count, term_counts?, reason?, records_preview[≤25]}. Iterate freely: propose → read counts → propose narrower. A crowd result (state:incomplete) is a descriptor for judgment — never a clean.",
      inputSchema: { type: "object", required: ["axis", "output_path", "proposals"], properties: {
        axis: { type: "string", description: "The register axis these supplementals belong to (e.g. primary-sweep)" },
        output_path: { type: "string", description: "Absolute path of the named band to merge into (register-units/<axis>-band.json)" },
        proposals: { type: "array", minItems: 1, items: { type: "object", properties: {
          predicate: { type: "string", enum: ["exact", "default", "wildcard", "phonetic", "owner"] },
          term: { type: "string" }, terms: { type: "array", items: { type: "string" } },
          romanization: { type: "string", description: "The Latin-script form of a NON-LATIN term — plain ASCII letters/digits, syllable-separated by single spaces, no tone marks or diacritics. On THIS source it does not rescue the slice: nativeScriptIndex is undeclared, so a non-Latin term defers and is disclosed rather than being answered by its romanisation." },
          owner: { type: "string", description: "OPTIONAL owner scope field on a MARK-TEXT proposal: the query is the owner×term intersection (the owner's filings within the term band). Not allowed on predicate:owner (there the owner name IS the term)." },
          nice_classes: { type: "array", items: {} },
          rationale: { type: "string" },
          term_literal: { type: "boolean", description: "TRUE only when the term genuinely IS the mark verbatim (a multi-word slogan mark, a mark carrying an anchored star) — it bypasses the term-shape lint. Never use it to push a label through." },
        } } },
      } },
      // ARITY: proposeSupplemental calls executePlan(auth, params, tctx) — THREE args. This core is
      // corsearch-shaped, (auth, params, tctx), so doExecutePlan could ride bare; it is wrapped anyway
      // to bind AUTH explicitly. The first positional here is what reaches the core as `auth`, and on
      // this provider that is the INDEX PATH, not a key — passing a credential-shaped value would send
      // every supplemental at a database named after it.
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
      handler: guard((a) => proposeSupplemental(a, tctx("propose_supplemental"), {
        executePlan: (params, t) => doExecutePlan(AUTH, params, t),
        capabilities: CAPABILITIES,
      })),
    },
  ],
});
