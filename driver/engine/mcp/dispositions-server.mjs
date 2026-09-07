#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// dispositions-server.mjs — the common-law lane's typed transport for meaning rulings.
//
// ── WHY ITS OWN KEY, WHICH IS THE WHOLE OF THIS FILE ───────────────────────────────────────────────
//
// This tool did not move because the code wanted tidying. It moved because it was GRANTED to three
// stages and ORDERED by one, and the two other holders arrived there as an allowlist side effect.
//
// `record_dispositions` shipped as a second tool on the shared `perplexity` entry, and `perplexity` is
// held by FOUR stages — `common-law`, `common-law-half`, `narrative-refutation`, `synthesis`. Because
// `allowedToolsFor` enumerates every tool on every entry a group resolves to, all four carried
// `mcp__perplexity__record_dispositions`, while every doctrinal mention of the tool is common-law's:
// `driver/skills/prelim-common-law/SKILL.md`, and the two common-law stage dictations in `stages.mjs`.
// Zero occurrences in synthesis's dictation block, zero in narrative-refutation's doctrine.
//
// That is GRANTED-BUT-NEVER-ORDERED, the defect class, in its mirror form: not a stage ordered to
// use a capability it lacks, but a seat holding one nothing ever tells it about. And here it is also a
// WRITER INTO ANOTHER LANE'S ACCUMULATOR — a synthesis seat handed the common-law lane's disposition
// ledger. `gather-config.mjs` named this exact hazard when it created the `coverage` key, about a
// different tool, and the ruling was applied there and not to this one, which was already sitting on
// the shared entry when it was written.
//
// ── THE SHAPE IS `coverage`'s AND `declination`'s, DELIBERATELY ────────────────────────────────────
//
// One tool, one key, granted by exactly one lane's group list. Not the RECORDING category: that
// category moves a stage's ARTIFACT to the driver — every row is `seatWrites: false` and the agreement
// guard proves the stage is never still ordered to hand-write it. Common-law is not doing that. It
// authors its stage output and keeps authoring it; the rulings already rode a tool rather than a file.
// So this is the `coverage`/`declination` shape: a typed transport on its own key, the RECORDING tables
// untouched.
//
// ── WHAT THE SPLIT COSTS, STATED RATHER THAN ASSUMED ───────────────────────────────────────────────
//
// The seat-facing tool name changes — `mcp__perplexity__record_dispositions` becomes
// `mcp__dispositions__record_dispositions`. Nothing in the doctrine names the namespaced form (every
// mention is the bare `record_dispositions`), and `disposition-call-audit.mjs` pairs call rows on
// `row.tool`, keyed by `(server, seq)` — both lines of one call come from one process, so the audit
// reads the new server name without a change. This IS an argv-surface change for four stages, so it
// ships `status:merged-awaiting-e2e`: the byte-level pins move in recording-grant-preservation.test.mjs
// and the live behaviour is unmeasured until a real run.
//
// ── WHAT IT IS NOT ────────────────────────────────────────────────────────────────────────────────
//
// It dials nothing. `perplexity-server.mjs` holds `PERPLEXITY_API_KEY` and the agent API and keeps
// them; this module reads one driver-written grid spec and hands its rows to the driver's accumulator.
// The retrieval surface is unchanged, which is the promise every typed-transport key in this build
// makes and the only one that matters for a grant review. `validateGridSpec` is imported from the
// perplexity core for the same reason it always was: the spec is that core's format, and re-deriving a
// validator here would be a second opinion about one file's shape.
import { readFileSync } from "node:fs";
import { serve } from "./stdio-server.mjs";
import { validateGridSpec } from "../../../providers/perplexity/src/core.js";
// B — the typed disposition transport. This server owns the seat-facing surface; the tool module owns
// the disk work and disposition-call.mjs owns the decision. One direction of import, no second opinion.
import { recordDispositions } from "../../disposition-tool.mjs";
import { MAX_ROWS_PER_CALL } from "../../disposition-call.mjs";

// ── B — THE TYPED DISPOSITION TRANSPORT ─────────────────────────────────────────────────────────────
//
// The seat sends VALUES; the driver writes the file. It exists because a model hand-typed a 140 KB JSON
// document, one row's delimiters were typographic quotes, and 74 correct legal rulings were voided by a
// quote character. made that failure visible and truthful; it could not make it impossible, because
// as long as a model types a structured document, typed-document-fails-to-parse is a failure this engine
// can have. Here the serialization is ours, so the class is gone rather than caught.
//
// THE SPEC PATH IS THE SEAT'S ONLY PATH ARGUMENT, and it is the same driver-written file the grid tool
// was given. 's rule: the path is the DRIVER'S, taken from the spec it wrote. Two derivations of one
// filename is the drift that cost weeks.
async function record_dispositions(params) {
  const { grid_spec_path, rows } = params ?? {};
  if (!grid_spec_path)
    return { isError: true, text: "ERROR: grid_spec_path is required — it is the same driver-written spec path the grid tool was given. Do not compose a path." };
  let spec;
  try { spec = validateGridSpec(JSON.parse(readFileSync(grid_spec_path, "utf8"))); }
  catch (err) { return { isError: true, text: `ERROR: grid_spec_path unreadable/invalid (${err.message}). The driver writes this file; do not hand-author it.` }; }
  if (!/\/studio\/prelim-search\//.test(spec.output_path))
    return { isError: true, text: `ERROR: grid spec.output_path must be within a studio/prelim-search run dir; got ${spec.output_path}` };
  // NEVER THROWN PAST THIS POINT. An exception surfaces to the seat as a tool error naming no row, which
  // tells it nothing about what to fix — the failure mode this transport exists to end.
  try {
    // ── — HAND THE RECORDER THE WHOLE CALL ────────────────────────────────────
    //
    // This passed `{ rows }` — a freshly built object — so `grid_spec_path` was gone one line before the
    // capture ran. The capture then wrote what it was given and stamped it "the typed call as RECEIVED",
    // which was true of the tool and false of the call: 38 of 38 archived payloads carried no
    // grid_spec_path, and an audit replaying them read that as a transport omitting a field its own
    // acceptor refuses a call without.
    //
    // The archive was never lossy. The call was narrowed before it got there. Its three sibling servers
    // all pass `params` whole; this one is now the fourth.
    const r = recordDispositions(spec, params);
    return { isError: !r.ok, text: r.text };
  } catch (e) {
    return { isError: true, text: `ERROR: the driver could not record this call (${String(e?.message ?? e).slice(0, 200)}). This is a driver fault, not a fault in your rulings — do not re-type them.` };
  }
}

serve({
  name: "dispositions", version: "0.1.0",
  tools: [{
    name: "record_dispositions",
    description: "Record your meaning rulings. Send VALUES, not a file: one entry per row, and the driver writes the document. You type NO identifier of any kind: give `row_index`, the NUMBER printed beside that obligation in the obligations block, and `receipt_index`, the POSITION of the candidate in that row's own list — the driver resolves both. Rows are validated against THAT row as they arrive, so you learn what to fix inside this turn; rows that validate are kept even when others in the same call are refused. The answer names every obligation still outstanding and which of them still owe proof of reading — a `segment_index` and a `fragment`.",
    inputSchema: { type: "object", required: ["grid_spec_path", "rows"], properties: {
      grid_spec_path: { type: "string", description: "Absolute path to the driver-written grid spec — the same one the grid tool was given." },
      rows: {
        type: "array",
        description: `Up to ${MAX_ROWS_PER_CALL} rows per call. Send more in a further call; the answer tells you what is left.`,
        items: { type: "object", required: ["row_index", "ruling", "note"], properties: {
          // — THE ADDRESS IS THE NUMBER ON THE PAGE. This advertised `row_id`, "exactly as the
          // obligations block lists it", and the block has never listed one: it printed each obligation
          // as "- <query>", and the sidecar it also named carries query strings. A seat reading this
          // schema had to invent something id-shaped or send the label it could actually see, and 28
          // calls on one production run sent the query and were refused `unknown_row` for it.
          row_index: { type: "integer", description: "The NUMBER of the obligation you are ruling on, as printed beside it in the obligations block (1, 2, …). Never a row id, never the query text — the number is the address." },
          ruling: { type: "string", description: "One of the accepted rulings." },
          note: { type: "string", description: "One line: what this receipt says, and why it reads that way." },
          receipt_index: { type: "integer", description: "The POSITION (1, 2, …) of the candidate you ruled on in this row's own list. Omit only when the row lists exactly one." },
          // — PROOF OF READING IS TWO FIELDS, and this schema advertised a third that no live path
          // reads. `anchor` was split into `segment_index` + `fragment` (disposition-call.mjs: "the two
          // duties it conflated"), and its refusal tokens are marked there as pointer-era with no live
          // emitter. So a seat that read this schema sent the one field the validator ignores and omitted
          // the two it refuses for — and learned the real shape only from refusal text, one round trip at
          // a time. The wording below is the refusal text, so the advertisement and the refusal now say
          // the same thing in the same words.
          segment_index: { type: "integer", description: "The NUMBER of the numbered passage you relied on, in the snippet of the receipt you ruled on (1, 2, …). Required for rows the answer marks as owing proof of reading." },
          fragment: { type: "string", description: "OPTIONAL, and never refused — #1172. The driver extracts the quote it stores from `segment_index` ALONE, so pointing at the passage is the whole obligation. If a few characters of that passage come easily, send them and they are recorded as a transcription check; if the script is one you cannot reproduce, omit it and nothing is lost. Do not translate: a translation is not a copy, and an empty field is better than a wrong one." },
          // — THE HONEST EXIT. Declared here because a seat can only take an exit it can see: the
          // one row that killed a production run was refused 217 times by a seat that had no way to say
          // it could not rule, and the schema is the half its tool-calling binds to.
          obstacle: { type: "string", description: "ONLY when this receipt supports no ruling at all: one line naming what in it blocks a ruling. Send this INSTEAD of `ruling` — never both. The row is then recorded as undecided, with your sentence shown to the reviewing lawyer in place of a ruling, and the stage completes rather than stalling on it. Prefer a ruling whenever you can give one; this is not a way past a hard row." },
        } },
      },
    } },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    handler: record_dispositions,
  }],
});
