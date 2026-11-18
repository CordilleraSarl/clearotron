// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// record-uri.mjs — the one key a register record is looked up by, wherever a reader stands. A leaf with no imports, so
// the run record log's index (`ledger.mjs`) and the driver's record joins (`driver/registry-fidelity.mjs`) key a
// record the same way: two readers of one log must not disagree about which row is the record's.

// WP-receipts W2 (the VENZY join defect): meter sources sometimes arrive as FULL provider URLs
// (https://tm.corsearch.com/mark/ae/229552) while the record set keys on /mark/ paths — without
// normalization a genuinely FETCHED record demotes to "assumed" at render, with a false integrity
// flag on top. Same broad id shape as pipeline.mjs CITED_URI_RE.
export function normalizeRecordUri(src) {
  const m = String(src ?? "").trim().match(/\/mark\/[a-z]{2,6}\/[a-z0-9][a-z0-9_-]*/i);
  return m ? m[0].toLowerCase() : "";
}
