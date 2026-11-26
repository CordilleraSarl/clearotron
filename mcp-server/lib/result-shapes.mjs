// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// lib/result-shapes.mjs — what each tool declares its result to be, and the result in that shape.
//
// THE DECLARATIONS LIVE IN ONE FILE, `mcp-server/result-shapes.json`, so a changed shape is a diff to that file and
// nothing else. This module reads it and does three things with it: it hands each tool's declared shape to the
// listing, it builds the structured result a call returns beside its text, and it builds the structured refusal.
//
// THE TEXT BLOCK IS NOT TOUCHED HERE. A host that reads only text keeps reading exactly what it read before. What is
// new (a write verb's `outcome`, a refusal's `reason`) is carried by the structured result alone.
//
// WHY THE SHAPES ARE PLAIN DRAFT-07, WITH NO `$schema`, `$id`, `description` OR `title`. A client compiles every
// declared shape when it lists the tools, and the SDK's client compiles with a draft-07 validator that caches by
// `$id`: a schema it cannot compile fails the listing, and loses the whole connector rather than one tool. A
// `description` would be a new sentence an assistant reads, and those are not this file's to add.
//
// A REFUSAL IS PART OF THE DECLARED SHAPE. The SDK's client validates a structured result whenever one is present,
// refusals included, so a verb that refuses with a structured reason declares the refusal as one of its forms.
import { readFileSync } from "node:fs";

const SHAPES = JSON.parse(readFileSync(new URL("../result-shapes.json", import.meta.url), "utf8"));

/**
 * The shape `name` declares to a session, or null where it declares none. `client` is true for the two client kinds,
 * whose answers are the scrubbed cut (server.mjs CLIENT_KINDS), so they are declared the scrubbed shape.
 */
export function outputSchemaFor(name, { client = false } = {}) {
  const entry = SHAPES[name];
  if (!entry) return null;
  return entry.all ?? entry[client ? "client" : "staff"] ?? null;
}

// THE SIX VERBS THAT CHANGE SOMETHING, and how each says whether it happened. Each reads a field the verb already
// returns, so the outcome is the verb's own fact under one name, never a second judgement of it.
const OUTCOMES = {
  start_run: (r) => (r?.queued === true ? "queued" : null),
  stop_run: (r) => (typeof r?.action === "string" ? r.action : null),
  feed_context: (r) => (r?.ok === true ? "written" : null),
  mark_sent: (r) => (r?.alreadySent === true ? "already-sent" : r?.alreadySent === false ? "marked-sent" : null),
  ack_event: (r) => (r?.alreadyGone === true ? "already-gone" : r?.alreadyGone === false ? "acknowledged" : null),
  what_if_run: (r) => (r?.queued === true ? "queued" : r?.ok === true ? "completed" : r?.ok === false ? "failed" : null),
};
export const WRITE_VERBS = Object.freeze(Object.keys(OUTCOMES));

// THE TOOLS THAT ANSWER FROM A RUN'S REPORT DOCUMENT, where it has one. Each answer names the version it was read from
// (`report-document/clearance-1`), or null where the call read the run's own files instead.
export const DOCUMENT_READERS = Object.freeze(["brief", "list_findings", "get_finding", "list_evidence", "list_searches", "get_search_coverage"]);

/**
 * The structured result a call returns beside its text, or null for a tool that declares no shape. A verb's result
 * gains its `outcome`; a report reader's gains `document`; a list goes out under `items`, because the protocol's
 * structured result is an object. `documents` is what the call noted it read (lib/document-reads.mjs).
 */
export function structuredResult(name, result, { documents = [] } = {}) {
  if (!SHAPES[name]) return null;
  if (OUTCOMES[name]) return { outcome: OUTCOMES[name](result), ...result };
  if (DOCUMENT_READERS.includes(name) && result && typeof result === "object" && !Array.isArray(result))
    return { ...result, document: documents[0] ?? null };
  return Array.isArray(result) ? { items: result } : result;
}

/** A write verb's refusal as a structured result: the outcome and the refusal's own sentence. Null for any other tool. */
export function structuredRefusal(name, reason) {
  if (!OUTCOMES[name] || !SHAPES[name]) return null;
  return { outcome: "refused", reason: String(reason) };
}
