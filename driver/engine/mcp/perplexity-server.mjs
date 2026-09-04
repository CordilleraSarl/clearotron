#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// Standalone MCP server wrapping the perplexity CORE so a `claude -p` process can call
// perplexity_research off-gateway. Replicates the plugin index handler VERBATIM (deterministic grid mode
// + normal/sandbox research). Auth = PERPLEXITY_API_KEY. The grid mode writes the ledger to
// spec.output_path itself (never round-trips the grid through the model's bounded turn output).
import { existsSync, readFileSync, writeFileSync, mkdirSync, appendFileSync } from "node:fs";
import { dirname, basename } from "node:path";
import { driverDir } from "../../../shared/driver-dir.mjs";   //
import { serve } from "./stdio-server.mjs";
import {
  detectPreset, VALID_PRESETS, buildRequestBody, callAgentAPI, formatResponse, formatSandboxResponse,
  validateGridSpec, buildGridProgramTask, captureGridFromResponse, requiredLedgerRefusal,
  reconcileGridLedger, findUnrecordedConnotationQueries, candidatesForJudgment,
} from "../../../providers/perplexity/src/core.js";
// — the seat's meaning-receipt obligations, told here because this is the first instant they exist.
// The SAME function the validator judges with (driver/connotation-search.mjs); see its doc block for why
// there is exactly one of it. Never re-derive any of this locally.
import { parsePrRiskResults, connotationObligations, renderConnotationObligations, obligationRows } from "../../connotation-search.mjs";
// — the form the seat fills in, built from those same obligations. The UNION, not the empty builder:
// see the write below for what an empty one cost.
// — `record_dispositions` LEFT THIS SERVER, and the reason is a grant rather than a tidy-up: it
// rode this shared key, `allowedToolsFor` enumerates every tool on every entry, and four stages held the
// key while one lane's doctrine ever ordered the tool. It is `dispositions-server.mjs` now, on its own
// key granted to the common-law lane alone; that file carries the whole argument.
// What stays is the GRID path's own need — the obligations sidecar written beside the grid's ledger.
import { obligationsSidecarPath } from "../../disposition-tool.mjs";
import { writeGridProvenance } from "./grid-provenance.mjs";   // — what served the grid, beside the ledger

const API_KEY = process.env.PERPLEXITY_API_KEY || "";

// ── — THE FREE-FORM CALL IS THE ONE NOTHING RECORDS ─────────────────────────────────────────────
//
// This server has two paths and only one of them was auditable. The GRID path writes its ledger to
// `spec.output_path` itself — machine receipts, saved verbatim, and reconciled against the dictated
// cells before the driver accepts them. The FREE-FORM path returns through formatResponse into the
// model's turn and touched no run-dir file at all, while `_driver/tool-calls.jsonl` records only
// `server / tool / axis / seq` — that a call happened, and nothing about it.
//
// So the driver could prove a lookup occurred and could not show what was asked or what came back. A
// seat's `**Use-check source:** <result URL>` line is retyped out of exactly that turn result, and
// nothing could distinguish a URL the tool returned from one composed around it.
//
// THE LOG IS NOT DISTRUST. It makes the seat's account CHECKABLE, which is what lets a later round
// trust it cheaply instead of re-deriving it. Emit-at-source, the same doctrine as the rest of the
// week: the fact exists at the moment of the call and is written then.
//
// THE RUN DIR ARRIVES UNDER A BAND-SHAPED NAME, and that is historical rather than wrong:
// gather-config's `serverEnv` builds ONE env object and hands it to EVERY local server, so
// CLEAROTRON_BAND_RUN_DIR has always been this process's run dir too — it was simply never read here.
// Reading the existing variable is deliberate: minting a second name for one fact is the defect this
// codebase spent 2026-08-14 removing.
const RUN_DIR = process.env.CLEAROTRON_BAND_RUN_DIR || "";
const SESSION = process.env.CLEAROTRON_GATHER_SESSION_KEY || "";
const AGENT = process.env.CLEAROTRON_GATHER_AGENT || "";

// WHAT IS LOGGED, AND WHAT IS DELIBERATELY NOT. The task text, the resolved preset and the flags that
// change what was searched — the answer to "what was asked". The response BODY is never written: it can
// run to tens of KB, it is the client's matter content, and the question this log exists to answer is
// answered by its SHAPE (ok, bytes, how many citations came back). The API key is never in `params` and
// never touches this file.
function logCall(tool, args, result) {
  if (!RUN_DIR) return;
  try {
    const p = driverDir(RUN_DIR, "reading-log.jsonl");
    mkdirSync(dirname(p), { recursive: true });
    appendFileSync(p, JSON.stringify({
      ts: new Date().toISOString(), tool, args, ...result,
      ...(SESSION ? { session: SESSION } : {}), ...(AGENT ? { agent: AGENT } : {}),
    }) + "\n");
  } catch { /* best-effort — a log failure must never break a lookup (band-server.mjs's rule) */ }
}

/** How many sources the answer carried, when the shape says so. Never the sources themselves. */
const citationCount = (data) => {
  const c = data?.citations ?? data?.search_results ?? data?.sources;
  return Array.isArray(c) ? c.length : null;
};

// ── — THE GRID IS A FACT OF THE RUN, NOT OF THE ATTEMPT ────────────────────────────────────────
// A cold retry of common-law-half re-calls this tool, and until now that re-ran the whole paid grid: the
// terminal production run of 2026-08-06 dispatched this stage ten times. The sweep's result cannot change
// between attempts of the same run — the spec is byte-identical, the ledger is on disk — so a retry that
// pays for it again buys nothing and delays convergence by minutes per attempt.
//
// THE GUARD IS COMPLETENESS, NOT MERE EXISTENCE, because a half-written ledger short-circuited into a
// "recorded" answer is a coverage hole that reads as a pass. Every dictated (term × platform) cell must be
// accounted and every dictated connotation query must carry a receipt, judged by the SAME two functions
// the driver's own gates use — reconcileGridLedger and findUnrecordedConnotationQueries. Anything less
// falls through and the grid runs, exactly as before.
function recordedLedgerFor(spec) {
  if (!existsSync(spec.output_path)) return null;
  let raw;
  try { raw = readFileSync(spec.output_path, "utf8"); } catch { return null; }
  let rec;
  try { rec = reconcileGridLedger(raw, spec); } catch { return null; }   // unparseable ⇒ re-run it
  if (rec.missing.length) return null;                                    // a cell never ran ⇒ re-run it
  if (findUnrecordedConnotationQueries(spec, rec.ledger).missing.length) return null;
  return rec;
}

// The obligations block and the obligations sidecar — everything the seat is told and given at
// the moment its obligations first exist. (The seat-facing FORM this comment used to promise died with
// the form path; rulings ride `record_dispositions`.) Best-effort as a whole (see the caller): the ledger is already
// on disk by the time this runs and the grid cost real money, so a fault here degrades the seat to
// learning by refusal and must never turn a completed grid into an error.
function tellObligations(spec, ledgerJson) {
  const ob = connotationObligations(parsePrRiskResults(ledgerJson));
  // — the path is the DRIVER'S, taken from the spec it wrote (splitGridSpec dictates it). Never
  // derived here: the validator reads the same file, and two derivations of one filename is the drift
  // cost weeks.
  const dispositionsPath = spec.connotation?.dispositions_path ?? null;
  const owed = renderConnotationObligations(ob, { ledgerPath: spec.output_path, dispositionsPath });
  // — THE ORDER IS RECORDED AT THE INSTANT THE PAGE IS WRITTEN, and it is the whole reason a
  // position is a safe address. `renderConnotationObligations` numbers off `obligationRows(ob)`; this is
  // the same call on the same object, so what lands here IS the numbering the seat can see. The tool
  // resolves the seat's numbers against this list rather than re-deriving one, because the obligation set
  // is re-derived every call against a ledger that can grow mid-turn — and a row inserted into the middle
  // of a fresh derivation would slide the page the seat is holding out from under it, silently.
  const rowsTold = obligationRows(ob).map((r) => r.row_id);
  writeFileSync(
    obligationsSidecarPath(spec.output_path),
    JSON.stringify({
      _provenance: `what the seat was TOLD it owed, computed by connotationObligations() from ${basename(spec.output_path)} at the moment the grid tool returned — the same calculation the validator judges with (#426)`,
      floor: ob.floor,
      queriesOwed: ob.queries.map((e) => e.query),
      rowsTold,
      recurrent: ob.recurrent.map(({ result, owners, reasons }) => ({
        result: String(result.url || result.title || "").trim(),
        queries: owners.map((o) => o.query),
        reasons,
      })),
      toldBytes: owed.length,
    }, null, 2) + "\n",
  );
  // B — NO SEAT-FACING FORM IS WRITTEN, ANY MORE, BY ANYONE. The -era write-back that lived here
  // (a union of the seat's file bytes into a rebuilt seat-facing form, plus 's whose-bytes referee)
  // died with the form path: the seat records rulings only through `record_dispositions`, the
  // accumulator in `_driver/` is the one copy and the tool is its writer mid-turn. What the seat needs
  // at this moment — the obligations, the candidates, the positions and the recording route — is all in
  // `owed` above, told in-turn.
  return owed;
}



async function research(params) {
  if (!API_KEY) return "ERROR: PERPLEXITY_API_KEY not set — marketplace research unavailable.";
  const { task, depth, model: modelOverride, allow_fetch = false, domain_filter, enable_sandbox = false, response_schema, schema_name, grid_spec_path } = params;

  // ── Deterministic grid mode: the caller dictates the cells; the tool runs + captures them. ──
  if (grid_spec_path) {
    let spec;
    try { spec = validateGridSpec(JSON.parse(readFileSync(grid_spec_path, "utf8"))); }
    catch (err) { return `ERROR: grid_spec_path unreadable/invalid (${err.message}). The driver writes this file; do not hand-author it.`; }
    if (!/\/studio\/prelim-search\//.test(spec.output_path))
      return requiredLedgerRefusal(`ERROR: grid spec.output_path must be within a studio/prelim-search run dir; got ${spec.output_path}`, { spec, gridSpecPath: grid_spec_path });
    // — already recorded and complete? Answer from the ledger; do not buy the grid twice.
    const already = recordedLedgerFor(spec);
    if (already) {
      const ledgerJson = JSON.stringify(already.ledger, null, 2);
      let owed = "";
      try { owed = tellObligations(spec, ledgerJson); } catch { /* best-effort — see tellObligations */ }
      const cands = candidatesForJudgment(already.ledger);
      writeGridProvenance(spec, { ran: false, present: already.present, requested: already.requested, model: modelOverride });
      return `Grid ALREADY RECORDED for this spec (${already.present}/${already.requested} cells present) at ${spec.output_path} — every dictated cell is accounted and every dictated meaning query carries a receipt, so it was NOT run again. The sweep is a fact of this run, not of this attempt.\n` +
        `Do NOT write the grid ledger yourself — it is already saved. Use the candidates below for judgment only.` +
        (cands.length ? `\n\nCandidate hits needing your taxonomy judgment (${cands.length}):\n` + JSON.stringify(cands, null, 2)
          : "\n\nNo candidate hits surfaced — every cell was clean.") +
        (owed ? `\n\n${owed}` : "");
    }
    const gridTask = buildGridProgramTask(spec);
    try {
      const data = await callAgentAPI(API_KEY, buildRequestBody({ task: gridTask, preset: "pro-search", modelOverride, enableSandbox: true }));
      const cap = captureGridFromResponse(data, spec);
      if (!cap.ok) return requiredLedgerRefusal(`ERROR: grid run failed — ${cap.error}.${cap.stderrTail ? ` stderr: ${cap.stderrTail}` : ""} Retry the call.`, { spec, gridSpecPath: grid_spec_path });
      mkdirSync(dirname(spec.output_path), { recursive: true });
      writeFileSync(spec.output_path, cap.ledgerJson + "\n");
      writeGridProvenance(spec, { ran: true, present: cap.present, requested: cap.requested, model: modelOverride });
      const note = cap.missing.length ? ` ${cap.missing.length} cell(s) the program did not return were recorded as honest gaps (coverage-limited).` : "";
      const judge = cap.candidates.length
        ? `\n\nCandidate hits needing your taxonomy judgment (${cap.candidates.length}):\n` + JSON.stringify(cap.candidates, null, 2)
        : "\n\nNo candidate hits surfaced — every cell was clean.";
      // The meaning-receipt obligations, from the ledger THIS call just wrote. Empty string when the seat
      // owns no meaning queries (half a always) — nothing is appended then.
      //
      // BEST-EFFORT, NEVER FATAL. The ledger is already on disk at this point; the grid cost real money and
      // real minutes. A fault in composing an advisory block must never turn that into "ERROR: grid research
      // failed", which would send the model back to re-run the whole grid. The gate still judges the same
      // obligations either way — the model would simply be learning them the old way, by refusal.
      //
      // AND IT IS RECORDED. Nothing in a run dir captures a tool RESULT — dispatch text is saved per
      // attempt, the model's turn is not — so without this the record cannot say what the seat was told,
      // and a round that improves cannot attribute the improvement to having been told. That is the
      // attribution the charter asks for: one run, one commit, and which change moved the result.
      // Written beside the ledger it was computed from, so no run-dir layout is inferred.
      let owed = "";
      try { owed = tellObligations(spec, cap.ledgerJson); } catch { /* best-effort, all of them: never cost a completed grid */ }
      return `Grid complete. The tool wrote the verbatim grid ledger (${cap.present}/${cap.requested} cells present) to ${spec.output_path}.${note}\n` +
        `Do NOT write the grid ledger yourself — it is already saved. Use the candidates below for judgment only.` +
        judge + (owed ? `\n\n${owed}` : "");
    } catch (err) { return requiredLedgerRefusal(`ERROR: grid research failed — ${err.message}${err?.cause ? ` (${err.cause.code || err.cause.name || err.cause})` : ""}`, { spec, gridSpecPath: grid_spec_path }); }
  }

  if (!task || task.trim().length === 0) {
    logCall("perplexity_research", { task: "", depth: depth ?? null }, { ok: false, error: "empty task" });
    return "ERROR: task parameter is required and must not be empty.";
  }
  const preset = depth && VALID_PRESETS.includes(depth) ? depth : detectPreset(task);
  // The resolved preset, not the requested one: `depth` is often absent and detectPreset decides, so
  // logging the request would record a null where the fact is what actually ran.
  const asked = { task, depth: depth ?? null, preset, allow_fetch, enable_sandbox,
    ...(domain_filter ? { domain_filter } : {}), ...(modelOverride ? { model: modelOverride } : {}) };
  try {
    const body = buildRequestBody({ task, preset, allowFetch: allow_fetch, domainFilter: domain_filter, modelOverride, enableSandbox: enable_sandbox, responseSchema: response_schema, schemaName: schema_name });
    const data = await callAgentAPI(API_KEY, body);
    const text = enable_sandbox ? formatSandboxResponse(data, preset) : formatResponse(data, preset);
    logCall("perplexity_research", asked, { ok: true, bytes: String(text ?? "").length, citations: citationCount(data) });
    return text;
  } catch (err) {
    // A FAILED LOOKUP IS LOGGED TOO, and that is the half that matters most: without it, "the search
    // ran and found nothing" and "the search errored" leave the same trace, which is the exact
    // ambiguity this whole issue is about.
    logCall("perplexity_research", asked, { ok: false, error: String(err?.message ?? err).slice(0, 200) });
    return `ERROR: Research failed — ${err.message}${err?.cause ? ` (${err.cause.code || err.cause.name || err.cause})` : ""}`;
  }
}

serve({
  name: "perplexity", version: "0.1.0",
  tools: [{
    name: "perplexity_research",
    description: "Web/marketplace research via Perplexity's agent API. Auto-detects depth (fast-search|pro-search|deep-research|advanced-deep-research) unless `depth` is given. For deterministic marketplace grids, pass `grid_spec_path` (absolute, the driver writes it) — the tool runs every (term × platform) cell and saves the verbatim ledger to the spec's output_path; you get back only candidates needing judgment (never write the grid yourself).",
    inputSchema: { type: "object", required: ["task"], properties: {
      task: { type: "string", description: "Sanitized research query (~200 tokens max)." },
      depth: { type: "string", enum: ["fast-search", "pro-search", "deep-research", "advanced-deep-research"] },
      model: { type: "string", description: "Optional model override." },
      allow_fetch: { type: "boolean", default: false },
      domain_filter: { type: "array", items: { type: "string" }, description: "Restrict/exclude domains (max 20), e.g. ['nature.com','-reddit.com']." },
      enable_sandbox: { type: "boolean", default: false, description: "Search-as-code mode." },
      response_schema: { type: "object", description: "JSON Schema for structured output." },
      schema_name: { type: "string" },
      grid_spec_path: { type: "string", description: "Absolute path to the driver-written grid spec (implies enable_sandbox)." },
    } },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    handler: research,
  }],
});
