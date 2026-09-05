#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// Standalone MCP server wrapping the EUIPO CORE under the NEUTRAL `register_*` names, so a `claude -p`
// process can call the EU register as the active register provider. Pure glue: the core owns all logic.
//
// ── THIS FILE REPLACED A SIDE-TOOL SERVER, AND THE DIFFERENCE IS THE POINT ────────────────────────
// It used to serve `euipo_search` / `euipo_record_fetch` and was mounted BESIDE the paid vendor on
// every register-unit stage, credential-blind — so an instance with no EUIPO key looked identical to
// one with a key, and the missing cross-check surfaced only as a model's unprompted aside. EUIPO is now
// a register provider like any other: selected by CLEAROTRON_DATABASE, fail-closed on its
// credential at preflight, ledgered, and planned against a declared capability contract.
//
// Telemetry: the core writes CLEAROTRON_REGISTER_CALL_LOG / CLEAROTRON_REGISTER_RECORD_LOG (the SHARED register ledger —
// one provider runs at a time) keyed by the GATEWAY session key, threaded in via
// CLEAROTRON_GATHER_SESSION_KEY so the provider-usage diff attributes calls to the run.
//
// ── SEVEN OF THE EIGHT NEUTRAL NAMES; ONE IS ABSENT ON PURPOSE ────────────────────────────────────
// `register_expand_phoneme` — there is no phonetic surface here to preview variants of. `=phonetic=`,
//   `=fuzzy=` and RSQL's own `~=` all return 400 at a valid `size` (probed 2026-08-09), so phonetic
//   SEARCH is unavailable too: capabilities.predicates.phonetic is null, the planner stamps the slice
//   `unsupported`, and it surfaces as a deferred coverage row rather than a contains wearing the
//   phonetic name. Doctrine 2 — a capability the provider genuinely lacks fails LOUDLY and is
//   disclosed; it never quietly degrades into a weaker query under the same tool name.
//
// `register_image_fetch` IS served, which was not obvious and was nearly declared absent: the detail
//   record's `markImage` carries only `{imageFormat, viennaClasses}` — no bytes, no URL. But
//   `GET /trademarks/{n}/image` answers 200 with real image bytes. The tool returns metadata + the
//   Vienna figurative-element codes rather than the bytes; see the core for why.
import { serve } from "./stdio-server.mjs";
import {
  CAPABILITIES, CRED_ENV, doSearch, doRecordFetch, doBatchScreen, doImageFetch,
  doEnumerate, doExecutePlan,
} from "../../../providers/euipo/src/core.js";
import { proposeSupplemental } from "./supplemental.mjs";

// The core resolves credentials from the environment; AUTH stays an object so a future knob (a pinned
// environment, a second subscription) does not change every call site.
const AUTH = {
  clientId: process.env.EUIPO_CLIENT_ID || "",
  clientSecret: process.env.EUIPO_CLIENT_SECRET || "",
  // item 2 — NO DEFAULT here either. This object is handed to resolveConfig, which now refuses
  // an empty environment by name; defaulting to "sandbox" here would reinstate the silent wrong-corpus
  // path one layer out and the adapter's refusal would never fire.
  environment: process.env.EUIPO_ENVIRONMENT || "",
};
const tctx = (kind) => ({
  kind,
  agentId: process.env.CLEAROTRON_GATHER_AGENT || "clawdi",
  sessionKey: process.env.CLEAROTRON_GATHER_SESSION_KEY || "",
  sessionId: process.env.CLEAROTRON_GATHER_SESSION_ID || "",
});
const passthrough = (r) => (r && typeof r === "object" ? (r.text ?? JSON.stringify(r)) : String(r));
const guard = (fn) => async (args) => {
  // Fail-closed, by name, BEFORE any call. An unset credential must never become an empty EU register.
  if (!AUTH.clientId || !AUTH.clientSecret) {
    return { isError: true, text:
      `ERROR: ${CRED_ENV} / EUIPO_CLIENT_SECRET not set — the EU register is unavailable. Refusing rather `
      + "than returning an empty result set, which would read downstream as a clean EU register." };
  }
  return passthrough(await fn(args));
};

// The query fields every mark-side tool accepts (search + enumerate share one vocabulary). `regions`
// IS accepted here, unlike on the single-office US index: the plan carries territorial scope and this
// provider REFUSES anything outside its coverage rather than silently searching the EU anyway.
const QUERY_PROPS = {
  name: { type: "string" },
  names: { type: "array", items: { type: "string" }, description: "the OR stack; the plan caps it at 50 terms (capabilities.maxOrWidth — a URL budget, not a clause count). Every group is parenthesised: `and` binds tighter than `or` here, so an unparenthesised stack is a wider query that still answers 200." },
  owner: { type: "string", description: "an applicant-name substring. Alone it IS the query (predicate owner); alongside names it is a SCOPE field — RSQL clauses AND-compose, so the owner×term slice runs in ONE call." },
  match_mode: { type: "string", enum: ["exact", "default", "starts_with", "ends_with"],
    description: "default = an unanchored contains (`*term*`). starts_with and ends_with are BOTH native — a leading wildcard matches here, which most registers cannot do. `phonetic` is absent: there is no sound-alike operator, so the slice defers and is disclosed rather than degrading to a contains." },
  nice_classes: { type: "array", items: { type: "integer" }, description: "Nice classes as bare numbers. Multiple classes cost ONE query (`niceClasses=in=`), not a fan-out." },
  nice_classes_mode: { type: "string", enum: ["any", "all"], default: "any" },
  status: { type: "array", items: { type: "string", enum: [...CAPABILITIES.queryableStatuses] },
    description: "EUIPO status tokens. NOTE this enum is 16 values, not the spec's 18: APPEALABLE and ACCEPTANCE_PENDING are REJECTED by the API (HTTP 400, probed one token at a time) — they can come back ON a row but cannot be filtered ON. Omit for all filings; screening classifies live/dead from the row anyway." },
  mark_feature: { type: "array", items: { type: "string" }, description: "WORD | FIGURATIVE | SHAPE_3D | COLOUR | SOUND | HOLOGRAM | OLFACTORY | POSITION | PATTERN | MOTION | MULTIMEDIA | OTHER" },
  regions: { type: "array", items: { type: "string" }, description: "territory codes. This source holds the EU register only (EUTM + IRs designating the EU); anything else is REFUSED as a deferred gap, never filtered away so the search runs EU-wide regardless." },
};

serve({
  name: "register", version: "0.1.0",
  tools: [
    {
      name: "register_search",
      description: "Search the EUIPO EU trade mark register (EUTMs + international registrations designating the EU); returns a paginated normalized list whose record_id is a synthetic /mark/eu/<applicationNumber> ref. Provide at least one element — an elementless search is REFUSED, never answered with the register. match_mode: default (unanchored contains)|exact|starts_with|ends_with. Multiple nice_classes cost ONE query. EU only: any other jurisdiction is a deferred gap decided upstream at plan time. Paging is page/size, size 10..100 (below 10 EVERY request 400s). Follow up with register_record_fetch for full detail — the search row carries NO goods and services and NO proceedings.",
      inputSchema: { type: "object", properties: {
        ...QUERY_PROPS,
        size: { type: "integer", minimum: 10, maximum: 100, description: "page size; 10 is the API's floor, not a preference" },
        page: { type: "integer", minimum: 0, description: "zero-based page number, not an offset" },
      } },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
      handler: guard((a) => doSearch(AUTH, a, tctx("search"))),
    },
    {
      name: "register_enumerate",
      description: "ENUMERATE a named band to COMPLETION — the completeness primitive. You choose the query (same fields as register_search); this tool owns the count probe, the OR-stack chunking and the screening, and CANNOT return a partial list. It returns ONE of two states: {state:'enumerated', total_hits, count, records[…screened]} when the whole band was retrieved; or {state:'incomplete', total_hits, fetched, sample, reason} when the band is a CROWD over the resource ceiling — a signal to escalate (narrow and re-enumerate, or hand the crowd to judgment as a descriptor), NEVER a clean negative. Screening is free here: the search row already carries status, classes and applicants, so no extra call is billed. Use this for the dangerous named band (the exact mark + each specific variant, in-scope classes).",
      inputSchema: { type: "object", properties: {
        ...QUERY_PROPS,
        in_scope_classes: { type: "array", items: { type: "number" }, description: "the SCREENING scope — it decides which records are marked out-of-class, and never narrows the query itself" },
      } },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
      handler: guard((a) => doEnumerate(AUTH, a, tctx("enumerate"))),
    },
    {
      name: "register_record_fetch",
      description: "Fetch the full NORMALIZED detail record for one EU trademark by record_id (a synthetic /mark/eu/<applicationNumber> ref, or a bare application number — 9 digits, or W + 8 digits for an IR designation). The normalized record is persisted for the driver's citation-fidelity gate. Returns neutral fields (applicationNumber/registrationNumber/dates/statusClass/statusDate/niceClasses/owner/representative/goodsAndServices) plus a public eSearch link. THIS is the only call that answers on proceedings: oppositions/cancellations/appeals/decisions appear ONLY on the detail record and are omitted when empty, so here an empty list means none are recorded — on a search row it would mean nothing at all.",
      inputSchema: { type: "object", required: ["record_id"], properties: {
        record_id: { type: "string", description: "a /mark/eu/<applicationNumber> ref or a bare application number" },
        language: { type: "string", description: "optional Accept-Language for the goods and services text" },
      } },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
      handler: guard((a) => doRecordFetch(AUTH, a, tctx("record_fetch"))),
    },
    {
      name: "register_batch_screen",
      description: "Batch-screen many record_ids in ONE call (`applicationNumber=in=(…)`, chunked at the OR-width bound). Per row: classes/status/owner/dates/mark_feature + computed live_status, all_class, and a closed-set screen_verdict (the SAME verdict vocabulary every register provider uses). Pass in_scope_classes. Returns `not_found[]` for any id the register did not return — that is an UNANSWERED id, not a screening verdict, and must be fetched before being treated as absent. NOTE these rows are NOT persisted for the citation gate: a search row is a partial record (no goods and services, no proceedings, no status date), and persisting it would let the gate verify a finding against a record that never claimed to be complete. Cite via register_record_fetch. NEVER drop a surface:* / deepfetch:* row on a guess.",
      inputSchema: { type: "object", required: ["uris"], properties: {
        uris: { type: "array", items: { type: "string" }, minItems: 1, description: "refs (/mark/eu/<n>) or bare application numbers" },
        in_scope_classes: { type: "array", items: { type: "number" } },
      } },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
      handler: guard((a) => doBatchScreen(AUTH, a, tctx("batch_screen"))),
    },
    {
      name: "register_image_fetch",
      description: "Figurative-mark image metadata for one record: { mark_feature, has_image, image_format, vienna_classes[], url, public_page }. The VIENNA CLASSES are the point — a device mark is compared on its figurative-element codes, and they are the comparable data. The bytes are NOT downloaded (they are not needed to compare marks and would cost real allowance per candidate); `url` is the authenticated API endpoint and is NOT citable to a reader, `public_page` is the eSearch address that is. A WORD mark returns has_image:false with a reason — that is an answer, not a failure.",
      inputSchema: { type: "object", required: ["record_id"], properties: {
        record_id: { type: "string", description: "a /mark/eu/<applicationNumber> ref or a bare application number" },
      } },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
      handler: guard((a) => doImageFetch(AUTH, a, tctx("image"))),
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
      description: "PROPOSE judgment-addition register queries; CODE executes them and writes the band (the supplemental lane — you never run register coverage by hand and never author band blocks). Each proposal: {predicate: exact|default|wildcard|phonetic|owner, term OR terms[] (OR-stack, split anything wider than the plan bound), romanization, owner? (a mark-text proposal may add an owner SCOPE FIELD — the owner×term intersection slice, which composes in ONE call here), nice_classes (REQUIRED — an unscoped sweep is rejected), rationale?, term_literal?}. Terms must be MARK-SHAPED and agree with the predicate: an anchored `*` needs predicate:wildcard, and a label/prose string is rejected — supply the mark terms it stands for. ONE PROPOSAL THIS SOURCE CANNOT HONOUR, and it DEFERS rather than degrades: predicate:phonetic (no sound-alike operator exists). A NON-LATIN term is fine here and is sent AS ITSELF — this index holds the characters (probed: Greek and Han contains both matched against an ASCII control), so a romanisation is never substituted. The tool mints each proposal as a qid'd supplemental plan entry (deterministic qid), executes them through the same deterministic executor as the dictated plan, MERGES the results into the band at output_path, and returns per-qid results: {state, total_hits, count, term_counts?, reason?, records_preview[≤25]}. Iterate freely: propose → read counts → propose narrower. A crowd result (state:incomplete) is a descriptor for judgment — never a clean.",
      inputSchema: { type: "object", required: ["axis", "output_path", "proposals"], properties: {
        axis: { type: "string", description: "The register axis these supplementals belong to (e.g. primary-sweep)" },
        output_path: { type: "string", description: "Absolute path of the named band to merge into (register-units/<axis>-band.json)" },
        proposals: { type: "array", minItems: 1, items: { type: "object", properties: {
          predicate: { type: "string", enum: ["exact", "default", "wildcard", "phonetic", "owner"] },
          term: { type: "string" }, terms: { type: "array", items: { type: "string" } },
          romanization: { type: "string", description: "The Latin-script form of a NON-LATIN term. On THIS source it is NOT used to rescue the slice — nativeScriptIndex is true, so the characters are sent as themselves and the romanisation is carried for the reader only." },
          owner: { type: "string", description: "OPTIONAL owner scope field on a MARK-TEXT proposal: the owner×term intersection. Not allowed on predicate:owner (there the owner name IS the term)." },
          nice_classes: { type: "array", items: {} },
          rationale: { type: "string" },
          term_literal: { type: "boolean", description: "TRUE only when the term genuinely IS the mark verbatim (a multi-word slogan mark, a mark carrying an anchored star) — it bypasses the term-shape lint. Never use it to push a label through." },
        } } },
      } },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
      handler: guard((a) => proposeSupplemental(a, tctx("propose_supplemental"), {
        executePlan: (params, t) => doExecutePlan(AUTH, params, t),
        capabilities: CAPABILITIES,
      })),
    },
  ],
});
