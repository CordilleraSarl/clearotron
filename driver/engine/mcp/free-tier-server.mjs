#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// Standalone MCP server wrapping the FREE-TIER COMPOSITE under the neutral `register_*` names — EUIPO
// and the local US index serving one clearance as a single register. Pure glue: the core owns the
// routing and every merge decision.
//
// ── THE SEAT IS NOT TOLD THERE ARE TWO SOURCES ──────────────────────────────────────────────────────
// Deliberately. The register skill's own instruction is "there is exactly ONE register in this run — if
// its coverage does not reach a territory the matter needs, that is a DEFERRED coverage row you
// disclose, never a gap you fill from somewhere else." That stays true here and must keep reading that
// way: the free tier IS one register, whose coverage happens to be EU+US. A seat told it has two
// sources would start choosing between them, and choosing is exactly what the plan already did.
//
// What the seat sees is the composite's DERIVED contract: OR-width 25 (the narrower member's bound),
// no phonetic predicate, oppositions unavailable, native-script undeclared. Every one of those is the
// weakest member's answer, because a promise the composite cannot keep everywhere is a promise it
// cannot keep.
//
// ── SEVEN OF THE EIGHT NEUTRAL NAMES ────────────────────────────────────────────────────────────────
// `register_expand_phoneme` is absent: neither member has a phonetic surface, so the intersected
// predicate is null and a phonetic slice defers and is disclosed rather than degrading into a contains
// wearing the phonetic name (doctrine 2).
//
// `register_image_fetch` IS served, and it is the one tool that is genuinely partial: EUIPO answers
// with image bytes, the local index holds none. A US record's image therefore refuses as a capability
// gap that says SOURCE LIMITATION, not "no image" — the distinction between "we cannot look" and "we
// looked and there is nothing" is the whole doctrine, and it does not stop being true inside one tool.
//
// Telemetry: the core writes CLEAROTRON_REGISTER_CALL_LOG / CLEAROTRON_REGISTER_RECORD_LOG (the SHARED register
// ledger) under the provider id `free-tier`, keyed by the gateway session key.
import { serve } from "./stdio-server.mjs";
import {
  CAPABILITIES, doSearch, doRecordFetch, doBatchScreen, doImageFetch, doEnumerate, doExecutePlan,
} from "../../../providers/free-tier/src/core.js";
import { proposeSupplemental } from "./supplemental.mjs";

// NULL, and it is not a placeholder. Each member core resolves its OWN credentials from the environment
// — EUIPO its OAuth pair, the index its file path — so there is no single auth object a composite could
// hold, and inventing one would put two sources' secrets behind one name.
const AUTH = null;

const tctx = (kind) => ({
  kind,
  agentId: process.env.CLEAROTRON_GATHER_AGENT || "clawdi",
  sessionKey: process.env.CLEAROTRON_GATHER_SESSION_KEY || "",
  sessionId: process.env.CLEAROTRON_GATHER_SESSION_ID || "",
});
const passthrough = (r) => (r && typeof r === "object" ? (r.text ?? JSON.stringify(r)) : String(r));
const CAPABILITY_OFFICES = CAPABILITIES.offices.covered.join("+");

// ── fail-closed on the EU HALF, by name — and NOT on the US index ────────────────────────────────────
//
// THE THIRD SITE OF ONE QUESTION, and it was left behind. driver.config.mjs says it plainly:
// fixed the half-check in preflightCredentials and left the other site, and would have made
// it a third. It did. This is that third site, and it went on requiring USPTO_LOCAL_DB after the other
// two stopped.
//
// The cost was total. On an EU-only box 's whole path worked — preflight passed, the plan compiled
// with the US split off as a disclosed deferral, the EU entry was executable — and then EVERY register_*
// tool the seat called was refused here, so the EU half never ran. Everything upstream was right and
// nothing downstream happened, which is the least legible way for a fix to fail.
//
// WHY REFUSING IS NOW WRONG. The old comment argued that with one qid per entry there is no shape for
// "half of this ran", so a half-configured tier must not run at all. That invariant still holds — it is
// simply no longer reached, because driver/register-availability.mjs splits an unreachable office off at
// PLAN COMPILE. Every qid arriving here is single-office. There is no half-run entry left to prevent,
// and refusing costs the EU coverage the box genuinely has.
//
// The EU pair stays required: a free tier with NO configured member is unconfigured, not degraded.
const MISSING = () => {
  const missing = [];
  if (!process.env.EUIPO_CLIENT_ID || !process.env.EUIPO_CLIENT_SECRET) missing.push("EUIPO_CLIENT_ID + EUIPO_CLIENT_SECRET");
  return missing;
};
const guard = (fn) => async (args) => {
  const missing = MISSING();
  if (missing.length) {
    return { isError: true, text:
      `ERROR: the free tier composes ${CAPABILITY_OFFICES} and is missing ${missing.join(" and ")}. `
      + "Refusing rather than searching nothing at all, which would read downstream as a clean register "
      + "over territories nothing looked at. To run ONE office deliberately, set "
      + "CLEAROTRON_DATABASE=euipo (EU) or =uspto-local (US) instead.\n"
      + "USPTO_LOCAL_DB is NOT required here: without it the US office is split off at plan compile and "
      + "disclosed as a deferred coverage row, and the EU half still runs." };
  }
  return passthrough(await fn(args));
};

const QUERY_PROPS = {
  name: { type: "string" },
  names: { type: "array", items: { type: "string" }, description: "the OR stack; the plan caps it at 25 terms — the NARROWER member's bound (capabilities.maxOrWidth is the min across sources, because a stack one source rejects is not a query this register can run)." },
  owner: { type: "string", description: "an owner-name substring. Alone it IS the query (predicate owner); alongside names it is a SCOPE field — both sources compose owner and mark text in one call, so the intersection never fans out." },
  match_mode: { type: "string", enum: ["exact", "default", "starts_with", "ends_with"],
    description: "default = an unanchored contains. `phonetic` is absent: NEITHER source has a sound-alike operator, so the slice defers and is disclosed rather than degrading to a contains." },
  nice_classes: { type: "array", items: { type: "integer" }, description: "Nice classes as bare numbers; both sources filter natively, so multiple classes cost one query per source." },
  nice_classes_mode: { type: "string", enum: ["any", "all"], default: "any" },
  regions: { type: "array", items: { type: "string" }, description: `territory codes. This register covers ${CAPABILITIES.offices.covered.join(", ")} — the EU register (EUTM + IRs designating the EU) and the US register. A code outside that is REFUSED as a deferred gap, never filtered away so the search runs over the rest regardless. Omit for the whole tier.` },
};

serve({
  name: "register", version: "0.1.0",
  tools: [
    {
      name: "register_search",
      description: `ONE page of the ${CAPABILITY_OFFICES} register. Rows come back merged across both offices; total_hits is the SUM and is NULL — never 0 — if either source could not state its own total, because a partial sum is a real number smaller than the truth and nothing downstream can tell it apart from a complete one.`,
      inputSchema: { type: "object", properties: { ...QUERY_PROPS, page: { type: "integer" }, size: { type: "integer" } } },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
      handler: guard((a) => doSearch(AUTH, a, tctx("search"))),
    },
    {
      name: "register_enumerate",
      description: `Page a band to completion across ${CAPABILITY_OFFICES}. Each office enumerates itself and the answers are merged: the band is "enumerated" only if EVERY source exhausted its own — one incomplete source makes the whole band an incomplete CROWD descriptor naming which source and why, never a clean negative over the half that did finish.`,
      inputSchema: { type: "object", properties: QUERY_PROPS },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
      handler: guard((a) => doEnumerate(AUTH, a, tctx("enumerate"))),
    },
    {
      name: "register_record_fetch",
      description: "The full official record for one record_id. Routed by the office IN the id (/mark/<office>/<id>), so a fetch can never reach the wrong source.",
      inputSchema: { type: "object", required: ["record_id"], properties: { record_id: { type: "string" } } },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
      handler: guard((a) => doRecordFetch(AUTH, a, tctx("record_fetch"))),
    },
    {
      name: "register_batch_screen",
      description: "Screen many record_ids at once. Ids are split by office, screened by their own source, and merged. An id belonging to no covered office REFUSES the whole call rather than screening the rest and reporting success — a silent drop here is a record that vanishes from the band with nothing saying so.",
      // `uris` is the parameter every other register provider declares (euipo, uspto-local, corsearch).
      // This one declared `record_ids` alone, and its core then forwarded that name to members that read
      // `uris` — so the members received nothing and the screen came back empty and error-free. Declaring
      // the canonical name means one skill doc serves every provider; `record_ids` stays accepted so a
      // caller written against the old schema keeps working.
      inputSchema: { type: "object", required: ["uris"], properties: {
        uris: { type: "array", items: { type: "string" }, minItems: 1, description: "record refs (/mark/<office>/<id>), split by office and screened by their own source" },
        record_ids: { type: "array", items: { type: "string" }, description: "accepted alias for `uris`" },
        in_scope_classes: { type: "array", items: { type: "number" } },
      } },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
      handler: guard((a) => doBatchScreen(AUTH, a, tctx("batch_screen"))),
    },
    {
      name: "register_image_fetch",
      description: "The figurative-mark image for a record. EU records answer; US records refuse as a SOURCE LIMITATION — the local index holds no images, which is not the same fact as a record having no image, and is never reported as one.",
      inputSchema: { type: "object", required: ["record_id"], properties: { record_id: { type: "string" } } },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
      handler: guard((a) => doImageFetch(AUTH, a, tctx("image"))),
    },
    {
      name: "register_execute_plan",
      description: `Execute the frozen register plan for ONE axis across ${CAPABILITY_OFFICES} and write the named band. One qid per plan entry, spanning both offices — the execution-receipt shape is identical to a single-source provider's.`,
      inputSchema: { type: "object", required: ["plan_path", "axis", "output_path"], properties: {
        plan_path: { type: "string" }, axis: { type: "string" }, output_path: { type: "string" },
        qids: { type: "array", items: { type: "string" } },
      } },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
      handler: guard((a) => doExecutePlan(AUTH, a, tctx("execute_plan"))),
    },
    {
      name: "register_propose_supplemental",
      description: "PROPOSE judgment-addition register queries; CODE executes them and writes the band. Each proposal: {predicate: exact|default|wildcard|owner, term OR terms[] (OR-stack, split anything wider than 25), nice_classes (REQUIRED), rationale?, term_literal?}. TWO proposals this register cannot honour, and it DEFERS rather than degrades: predicate:phonetic (neither source has a sound-alike operator), and a NON-LATIN term (native-script indexing is undeclared on one source — an undeclared index may not be searched as though it held the characters, and may not be silently romanised either).",
      inputSchema: { type: "object", required: ["axis", "output_path", "proposals"], properties: {
        axis: { type: "string" },
        output_path: { type: "string" },
        proposals: { type: "array", minItems: 1, items: { type: "object", properties: {
          predicate: { type: "string", enum: ["exact", "default", "wildcard", "phonetic", "owner"] },
          term: { type: "string" }, terms: { type: "array", items: { type: "string" } },
          romanization: { type: "string" },
          owner: { type: "string" },
          nice_classes: { type: "array", items: {} },
          rationale: { type: "string" },
          term_literal: { type: "boolean" },
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
