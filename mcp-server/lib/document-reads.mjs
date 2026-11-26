// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// lib/document-reads.mjs — which version of a run's report document a call actually read.
//
// An answer read from a run's report document names the version it was read from (`report-document/clearance-1`,
// `report-document/knockout-1`). Which version that is, and whether the call read the document at all or the run's own
// files, is known only where the document is read, several modules down. So each place that reads it notes the
// version here, and the call's dispatcher collects what its own call noted.
//
// PER CALL, NOT PER PROCESS. The HTTP doors serve concurrent calls in one process, so the notes live in the call's
// async context (AsyncLocalStorage): one call's read can never be credited to another's answer.
import { AsyncLocalStorage } from "node:async_hooks";

const reads = new AsyncLocalStorage();

/** Run `fn` and return its value with the document versions it read, in the order first read. */
export async function withDocumentReads(fn) {
  const seen = new Set();
  const value = await reads.run(seen, fn);
  return { value, documents: [...seen] };
}

/** Note that the current call read `doc`, and hand it back. Outside a dispatched call it notes nothing. */
export function noteDocumentRead(doc) {
  const seen = reads.getStore();
  if (seen && typeof doc?.document === "string") seen.add(doc.document);
  return doc;
}
