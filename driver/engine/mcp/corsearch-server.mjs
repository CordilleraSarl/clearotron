#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// Standalone MCP server wrapping the corsearch CORE (pure node+fetch) so a `claude -p` process can
// call the register-search tools off-gateway. Pure glue: the cores own all logic. Auth = CORSEARCH_SESSION_KEY
// (the cookie). Telemetry: the cores write CLEAROTRON_REGISTER_CALL_LOG / CLEAROTRON_REGISTER_RECORD_LOG keyed by the GATEWAY
// session key (tctx.sessionKey) — we thread the run's session key via CLEAROTRON_GATHER_SESSION_KEY so the
// $0 provider-usage diff still attributes calls to the run.
import { serve } from "./stdio-server.mjs";
import { CAPABILITIES, doSearch, doRecordFetch, doImageFetch, doExpandPhoneme, doBatchScreen, doEnumerate, doExecutePlan } from "../../../providers/corsearch/src/core.js";
import { proposeSupplemental } from "./supplemental.mjs";

const COOKIE = process.env.CORSEARCH_SESSION_KEY || "";
const tctx = (kind) => ({
  kind,
  agentId: process.env.CLEAROTRON_GATHER_AGENT || "clawdi",
  sessionKey: process.env.CLEAROTRON_GATHER_SESSION_KEY || "",   // run session key — telemetry attribution
  sessionId: process.env.CLEAROTRON_GATHER_SESSION_ID || "",
});
const passthrough = (r) => (r && typeof r === "object" ? (r.text ?? JSON.stringify(r)) : String(r));
const guard = (fn) => async (args) => {
  if (!COOKIE) return { isError: true, text: "ERROR: CORSEARCH_SESSION_KEY not set — register-search unavailable." };
  return passthrough(await fn(args));
};

serve({
  name: "register", version: "0.2.0",
  tools: [
    {
      name: "register_search",
      description: "Search Corsearch's supremesearch trademark index; returns paginated normalized records. Provide at least one element (id, name, names, owner, product, representative). match_mode: default|exact|phrase|starts_with|ends_with|phonetic|fuzzy|not|must. For phonetic, call register_expand_phoneme first and pass aiVariants as phonetic_variants.",
      inputSchema: { type: "object", properties: {
        id: { type: "string" }, name: { type: "string" }, names: { type: "array", items: { type: "string" } },
        match_mode: { type: "string", enum: ["default", "exact", "phrase", "starts_with", "ends_with", "phonetic", "fuzzy", "not", "must"] },
        phonetic_variants: { type: "array", items: { type: "string" } },
        owner: { type: "string" }, product: { type: "string" }, representative: { type: "string" },
        nice_classes: { type: "array", items: { type: "integer" } },
        registries: { type: "array", items: { type: "string" } }, regions: { type: "array", items: { type: "string" }, description: "UPPERCASE 2-letter region codes, e.g. ['US','EU','CH'] — never spelled-out names (recognized display names are normalized; unknown values are rejected)" },
        owner_country: { type: "string" }, name_not: { type: "array", items: { type: "string" } },
        application_date_after: { type: "string" }, application_date_before: { type: "string" },
        registration_date_after: { type: "string" }, registration_date_before: { type: "string" },
        limit: { type: "integer", minimum: 1, maximum: 100 }, page: { type: "integer", minimum: 0 },
        sort: { type: "string", enum: ["Relevancy", "ApplicationDate", "RegistrationDate", "Name", "Owner"] },
        ascending: { type: "boolean" }, fields: { type: "array", items: { type: "string" } },
      } },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
      handler: guard((a) => doSearch(COOKIE, a, tctx("search"))),
    },
    {
      name: "register_enumerate",
      description: "ENUMERATE a named band to COMPLETION — the completeness primitive. You choose the query (same fields as register_search: name/names/match_mode/nice_classes/regions/owner_country/…); this tool owns the page loop and CANNOT return a partial list. It returns ONE of two states: {state:'enumerated', total_hits, count, records[…batch-screened]} when it paged to has_more:false (every named record, already screened with class/status/owner/screen_verdict); or {state:'incomplete', total_hits, fetched, sample, reason} when the band is a CROWD (over the resource ceiling), the provider 5000-record window was hit, or a provider error occurred — a signal to escalate (narrow the query to the named band and re-enumerate, or hand the crowd to judgment as a descriptor), NEVER a clean negative. Use this for the dangerous named band (the exact mark + each specific variant, in-scope classes, per jurisdiction). For a saturation CROWD, use register_search limit:1 as a count-only descriptor — do not enumerate it.",
      inputSchema: { type: "object", properties: {
        id: { type: "string" }, name: { type: "string" }, names: { type: "array", items: { type: "string" } },
        match_mode: { type: "string", enum: ["default", "exact", "phrase", "starts_with", "ends_with", "phonetic", "fuzzy", "not", "must"] },
        phonetic_variants: { type: "array", items: { type: "string" } },
        owner: { type: "string" }, product: { type: "string" }, representative: { type: "string" },
        nice_classes: { type: "array", items: { type: "integer" } },
        registries: { type: "array", items: { type: "string" } }, regions: { type: "array", items: { type: "string" }, description: "UPPERCASE 2-letter region codes, e.g. ['US','EU','CH'] — never spelled-out names (recognized display names are normalized; unknown values are rejected)" },
        owner_country: { type: "string" }, name_not: { type: "array", items: { type: "string" } },
        application_date_after: { type: "string" }, application_date_before: { type: "string" },
        registration_date_after: { type: "string" }, registration_date_before: { type: "string" },
        sort: { type: "string", enum: ["Relevancy", "ApplicationDate", "RegistrationDate", "Name", "Owner"] },
        ascending: { type: "boolean" }, fields: { type: "array", items: { type: "string" } },
        in_scope_classes: { type: "array", items: { type: "number" } },
      } },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
      handler: guard((a) => doEnumerate(COOKIE, a, tctx("enumerate"))),
    },
    {
      name: "register_record_fetch",
      description: "Fetch the full detail record for one trademark by URI (e.g. /mark/cn/28965365-45). translate=true auto-translates non-English goods/services.",
      inputSchema: { type: "object", required: ["record_id"], properties: {
        record_id: { type: "string", description: "Trademark URI, e.g. /mark/cn/28965365-45" },
        translate: { type: "boolean", default: false },
      } },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
      handler: guard((a) => doRecordFetch(COOKIE, a, tctx("record_fetch"))),
    },
    {
      name: "register_image_fetch",
      description: "Fetch metadata + URL for a trademark's figurative image. Returns { url, content_type, size_bytes, requested_size }.",
      inputSchema: { type: "object", required: ["image_path"], properties: {
        image_path: { type: "string", description: "imagePath from a detail record, e.g. /cn/545/28965365-45.png" },
        size: { type: "string", default: "300x200" },
      } },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
      handler: guard((a) => doImageFetch(COOKIE, a, tctx("image"))),
    },
    {
      name: "register_expand_phoneme",
      description: "Generate phonetic-variant spellings via Corsearch's AI phoneme expansion. Returns { base, aiVariants }. Call before register_search match_mode='phonetic'. Language matters: en_US/de_DE/fr_FR/it_IT/es_ES.",
      inputSchema: { type: "object", required: ["word"], properties: {
        word: { type: "string", description: "Seed mark text, e.g. 'NIKE'" },
        language: { type: "string", default: "en_US" },
      } },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
      handler: guard((a) => doExpandPhoneme(COOKIE, a, tctx("phoneme"))),
    },
    {
      name: "register_execute_plan",
      description: "Execute the run's FROZEN register plan (_driver/register-plan.json) for ONE axis in a single call: the tool runs every dictated entry itself (enumerates page to has_more:false; count entries stay count-only crowd descriptors; a when-guarded fringe runs only if its parent slice enumerated) and WRITES the named band to output_path itself, each block stamped with its qid. MERGES with any existing band: your judgment-addition blocks (no qid) and other axes' blocks survive; this axis's dictated blocks are refreshed. Returns a compact summary {written, blocks, executed, preserved, skipped, states} — never the band content. Do NOT run dictated plan entries manually; use this call, then add judgment extras via register_propose_supplemental.",
      inputSchema: { type: "object", required: ["plan_path", "axis", "output_path"], properties: {
        plan_path: { type: "string", description: "Absolute path to the frozen _driver/register-plan.json" },
        axis: { type: "string", description: "The register axis to execute (e.g. primary-sweep)" },
        output_path: { type: "string", description: "Absolute path of the named band to write (register-units/<axis>-band.json)" },
      } },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
      handler: guard((a) => doExecutePlan(COOKIE, a, tctx("execute_plan"))),
    },
    {
      name: "register_propose_supplemental",
      description: "PROPOSE judgment-addition register queries; CODE executes them and writes the band (the supplemental lane — you never run register coverage by hand and never author band blocks). Each proposal: {predicate: exact|default|wildcard|phonetic|owner, term OR terms[] (OR-stack, split anything wider than the plan bound), owner? (a mark-text proposal may add an owner SCOPE FIELD — the owner×term intersection slice, the watchlist-coverage move), nice_classes (REQUIRED — an unscoped sweep is rejected), regions?, rationale?, term_literal? (true asserts the term IS a mark verbatim, bypassing the shape lint)}. Terms must be MARK-SHAPED and agree with the predicate: an anchored `*` needs predicate:wildcard, and a label/prose string (>4 words, parentheticals) is rejected — supply the mark terms it stands for. The tool mints each proposal as a qid'd supplemental plan entry (deterministic qid — re-proposing the same query reuses it, never duplicates), executes them through the same deterministic executor as the dictated plan (count-first per-term truth, ceiling, chunking, error stamping), MERGES the results into the band at output_path itself, and returns per-qid results read back from the band: {state, total_hits, count, term_counts?, reason?, records_preview[≤25]}. Iterate freely: propose → read counts → propose narrower. A crowd result (state:incomplete) is a descriptor for judgment — never a clean.",
      inputSchema: { type: "object", required: ["axis", "output_path", "proposals"], properties: {
        axis: { type: "string", description: "The register axis these supplementals belong to (e.g. primary-sweep)" },
        output_path: { type: "string", description: "Absolute path of the named band to merge into (register-units/<axis>-band.json)" },
        proposals: { type: "array", minItems: 1, items: { type: "object", properties: {
          predicate: { type: "string", enum: ["exact", "default", "wildcard", "phonetic", "owner"] },
          term: { type: "string" }, terms: { type: "array", items: { type: "string" } },
          romanization: { type: "string", description: "OPTIONAL on this provider (its index holds the characters and answers them directly), but STATE IT anyway for a non-Latin term — the plan is provider-neutral and the entry carries both forms for whichever register expresses it. Latin-script form only: plain ASCII letters/digits, syllable-separated by single spaces, no tone marks or diacritics. Single-term proposals only; never on an already-Latin term." },
          owner: { type: "string", description: "OPTIONAL owner scope field on a MARK-TEXT proposal: the query is the owner×term intersection (the owner's filings within the term band). Not allowed on predicate:owner (there the owner name IS the term)." },
          nice_classes: { type: "array", items: {} }, regions: { type: "array", items: { type: "string" }, description: "UPPERCASE 2-letter region codes, e.g. ['US','EU','CH'] — never spelled-out names (recognized display names are normalized; unknown values are rejected)" },
          rationale: { type: "string" },
          term_literal: { type: "boolean", description: "TRUE only when the term genuinely IS the mark verbatim (a multi-word slogan mark, a mark carrying an anchored star) — it bypasses the term-shape lint. Never use it to push a label through." },
        } } },
      } },
      // — the executor is bound HERE, in a closure, exactly as the other five providers bind
      // theirs. It used to be passed as a bare function, which made this the one provider whose
      // credential really did travel through the kernel: proposeSupplemental threaded its first
      // argument straight into executePlan, and corsearch's doExecutePlan(sessionKey, …) forwards
      // that to doSearch and onto the wire. The other five discarded it in a `_auth` wrapper, so the
      // threading looked vestigial from any of them — and dropping the parameter without this line
      // would have handed corsearch `params` as its auth and `tctx` as its params.
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
      handler: guard((a) => proposeSupplemental(a, tctx("propose_supplemental"), {
        executePlan: (params, t) => doExecutePlan(COOKIE, params, t),
        capabilities: CAPABILITIES,
      })),
    },
    {
      name: "register_batch_screen",
      description: "Batch-hydrate SCREENING data for many URIs in one call (brand-json), chunked at 100/call. Per row: classes/status/owner/dates/jurisdictions/markFeatures + computed live_status, all_class, and a closed-set screen_verdict. Pass in_scope_classes. NEVER drop a surface:* / deepfetch:* row on a guess without a record_fetch.",
      inputSchema: { type: "object", required: ["uris"], properties: {
        uris: { type: "array", items: { type: "string" }, minItems: 1 },
        in_scope_classes: { type: "array", items: { type: "number" } },
      } },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
      handler: guard((a) => doBatchScreen(COOKIE, a, tctx("batch_screen"))),
    },
  ],
});
