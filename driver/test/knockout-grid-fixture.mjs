// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// knockout-grid-fixture.mjs — a knockout web search that answered, for tests that inject the sweep's executors.
//
// The ledger goes through the live path's own reconcile, so what a test hands the lane has the shape a
// provider's answer is given there: every cell the spec asked for, and a cell the program did not return
// as a gap rather than a hole.
import { reconcileGridLedger } from "../../providers/perplexity/src/core.js";

/**
 * One grid call's answer over `spec`: every dictated cell, with `candidates` on the first (the first
 * spelling on the first place) and none on the rest, in the ledger shape the program is told to print.
 * The executor contract's own shape.
 */
export function answeredGrid(spec, candidates = []) {
  const cells = spec.terms.flatMap((term, i) => spec.platforms.map((platform, j) => {
    const own = i === 0 && j === 0 ? candidates : [];
    return { term, platform, status: own.length ? "hit" : "no_hit", candidates: own };
  }));
  const rec = reconcileGridLedger(JSON.stringify({ cells, gaps: [], extras: {} }), spec);
  const ledgerJson = JSON.stringify(rec.ledger, null, 2);
  return { ok: true, ledgerJson, requested: rec.requested, present: rec.present, bytes: Buffer.byteLength(ledgerJson) };
}
