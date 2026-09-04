// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// row-address-is-a-position.test.mjs —: the seat addresses an obligation by its NUMBER, and the
// number it counts off is the one the driver printed.
//
// ── WHAT THIS IS DEFENDING, AND WHY THE ISSUE'S OWN DIAGNOSIS IS NOT IT ──────────────────────────────
//
// is titled "the meaning seat invents its own row ids". It never invented one. It was never given
// one. Four statements, all live on main before this file existed:
//
//   1. The obligations block's header: "YOU CITE NO IDENTIFIER ANYWHERE."
//   2. Fifty lines down: "each with `row_id` (exactly as the obligations sidecar lists it)".
//   3. Nine lines below that: "The position is enough. You never type an id".
//   4. The sidecar named in (2) carries `queriesOwed` — query strings. It has never held a row id, and
//      neither did the block, which printed each obligation as "- <query>".
//
// So the seat was ordered to copy an identifier out of a document containing none, by a page that twice
// told it to copy no identifier at all. It sent the one per-row label it had been shown — the query —
// and 28 calls on one production run were refused `unknown_row` for it, 10% of every refusal on the run.
// Then the tool's ANSWER named what was still outstanding as bare `Q-…` tokens, which appear nowhere the
// seat has read, so it could not map a single one back to a query it held.
//
// The cure is the one already shipped one field over for `receipt_id`: the seat gives a POSITION and the
// driver resolves it. A validator that refuses an invention has moved the defect; an address that cannot
// be invented removes it.
//
// ── THE PROPERTY THAT COSTS SOMETHING TO GET WRONG ──────────────────────────────────────────────────
//
// A wrong id is refused. A WRONG NUMBER IS ACCEPTED. So positional addressing is only safe while the
// numbering the seat is holding is the numbering the driver resolves against — and the obligation set is
// re-derived on every call against a ledger that can grow mid-turn. The last three tests here pin that
// the resolution follows the page, not the re-derivation.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  obligationRows, connotationObligations, renderConnotationObligations,
} from "../connotation-search.mjs";
import { validateDispositionCall, addressableRows, CALL_ROW_FIELDS } from "../disposition-call.mjs";
import { outstandingWithAnchors, obligationsSidecarPath } from "../disposition-tool.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SNIPPET = "The 1871 Meridian race riot was a violent episode recorded in contemporary newspapers.";
const RECORDED = [
  { query: "MERIDIAN THISTLE gang", results: [
    { title: "first", url: "https://e.test/1", snippet: SNIPPET },
    { title: "second", url: "https://e.test/2", snippet: "y".repeat(240) }] },
  { query: "MERIDIAN THISTLE offensive", results: [
    { title: "only", url: "https://e.test/3", snippet: "z".repeat(240) }] },
];
const ob = () => connotationObligations(RECORDED);
const rows = () => obligationRows(ob());
const block = () => renderConnotationObligations(ob(), { dispositionsPath: "/run/_driver/d.json" });

test("#1173 every obligation on the page carries a NUMBER, and it is its position in the driver's row list", () => {
  const text = block();
  const canonical = rows();
  assert.ok(canonical.length >= 2, "premise held: the fixture owes more than one row, or this measures nothing");
  for (const [i, r] of canonical.entries()) {
    const n = i + 1;
    const label = r.kind === "recurrence" ? null : r.query;
    if (!label) continue;
    // The number, then the row's own text, on one line. Anything looser would pass on a page that
    // numbered its rows in a different order than the validator resolves them in.
    assert.ok(new RegExp(`^\\s*${n}\\.\\s+${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "m").test(text),
      `obligation ${n} (${label}) is not printed with its number — the seat cannot count off a page that does not number`);
  }
});

test("#1173 the page shows the seat NO row id — not in the list, and not in the instructions", () => {
  const text = block();
  for (const r of rows())
    assert.ok(!text.includes(r.row_id),
      `the block prints row id ${r.row_id}. Showing an id is inviting one back: #850 M1 recorded 27 invented `
      + "tokens from a page that merely displayed an id's SHAPE. The number is the address now.");
  assert.ok(!/\brow_id\b/.test(text),
    "the block still orders `row_id`. That field is not in the accepted call shape, so a seat obeying this "
    + "page is refused for obeying it — which is the whole of #1173.");
});

test("#1173 the receipt ordinals on the page index the SAME list the driver resolves against", () => {
  // `receipt_index` resolves against the row's `candidates`, which drops any result the driver could mint
  // no id for; the page used to number `e.results`, which keeps them. One such result and every ordinal
  // below it in that row pointed one candidate off — the seat naming receipt 3 and the driver binding
  // receipt 4's id, silently, on a row it had read correctly.
  const text = block();
  for (const r of rows()) {
    if (r.kind === "recurrence") continue;
    for (const [i, c] of r.candidates.entries())
      assert.ok(new RegExp(`^\\s*${i + 1}\\.\\s+${c.receipt_id}\\b`, "m").test(text),
        `receipt ${i + 1} of row "${r.query}" is not printed as ${c.receipt_id} — the display and the `
        + "resolution are counting two different lists");
  }
});

test("#1173 the accepted shape takes a position and the tool advertises exactly that", () => {
  assert.ok(CALL_ROW_FIELDS.includes("row_index"), "the address is a position");
  assert.ok(!CALL_ROW_FIELDS.includes("row_id"), "the id is not in the accepted shape at all");
  // — the ADVERTISEMENT half moved to `dispositions-server.mjs`; the sidecar arm further down
  // still reads perplexity-server, because the sidecar is written by the GRID path and that stayed.
  const server = readFileSync(join(ROOT, "driver", "engine", "mcp", "dispositions-server.mjs"), "utf8");
  const at = server.indexOf('name: "record_dispositions"');
  assert.ok(at > 0, "record_dispositions is no longer declared");
  const decl = server.slice(at, server.indexOf("handler: record_dispositions", at));
  assert.match(decl, /row_index: \{ type: "integer"/, "the schema must advertise the position it accepts");
  assert.ok(!/\brow            _id:/.test(decl.replace(/row_id:/g, "row            _id:")) || true);
  assert.ok(!/row_id: \{/.test(decl),
    "the schema advertises `row_id` again — a seat reading it would send the one field the validator refuses");
});

test("#1173 a query string sent as an address is answered with the NUMBER that query is", () => {
  // The literal observed payload. The old answer said only that the value was not a row id, which the
  // seat could not act on: nothing it had read carried one.
  const r = validateDispositionCall(
    [{ row_id: "MERIDIAN THISTLE offensive", ruling: "benign", note: "n", receipt_index: 1 }], RECORDED);
  assert.equal(r.refused[0].reason, "row_addressed_by_id");
  assert.match(r.refused[0].detail, /row 2 in the obligations list/,
    "a refusal that cannot name the remedy costs a round trip and teaches nothing");
});

test("#1173 the tool's ANSWER names outstanding rows by number, not by a token nobody was shown", () => {
  const left = outstandingWithAnchors(rows(), []);
  assert.equal(left.length, rows().length, "premise held: nothing is ruled, so everything is outstanding");
  assert.deepEqual(left.map((r) => r.row_index), rows().map((_, i) => i + 1));
});

test("#1173 the addressing list is the order the driver RECORDED, so a mid-turn re-derivation cannot renumber", () => {
  const canonical = rows();
  const told = ["Q-GONEFROMTHISRUN", ...canonical.map((r) => r.row_id)];
  const addressable = addressableRows(canonical, told);
  assert.equal(addressable[0], null, "a told row that is no longer owed keeps its SLOT");
  assert.equal(addressable[1], canonical[0], "everything after the hole keeps the number it was given");
  assert.equal(addressable.length, told.length, "nothing is dropped and nothing slides up");

  const r = validateDispositionCall(
    [{ row_index: 2, ruling: "benign", note: "n", receipt_index: 1, segment_index: 1, fragment: "1871 Meridian" }],
    RECORDED, { told });
  assert.deepEqual(r.refused, [], "the seat's 2 addresses what the driver's page called 2");
  assert.equal(r.accepted[0].receipt_id, canonical[0].candidates[0].receipt_id);
});

test("#1173 a row that appears only in the fresh derivation is APPENDED, never inserted", () => {
  // A ledger top-up is the case: it adds obligations, and inserting one ahead of a row the seat is
  // holding would re-point that seat's number at a different obligation. Accepted, not refused. Silent.
  const canonical = rows();
  const told = [canonical[1].row_id];                       // the driver only ever showed the second row
  const addressable = addressableRows(canonical, told);
  assert.equal(addressable[0], canonical[1], "the told row keeps position 1 — that is what the seat saw");
  assert.equal(addressable[1], canonical[0], "the row it was never shown lands after it");
});

test("#1173 the driver records the order at the moment it renders the page", () => {
  // The sidecar is written by perplexity-server.mjs and read by disposition-tool.mjs. Both ends must
  // spell its path the same way, which is why there is one function for it (/) — and the reader
  // fails OPEN, so a drift here would silently fall back to renumbering rather than erroring.
  const server = readFileSync(join(ROOT, "driver", "engine", "mcp", "perplexity-server.mjs"), "utf8");
  assert.match(server, /rowsTold = obligationRows\(ob\)\.map\(\(r\) => r\.row_id\)/,
    "the sidecar no longer records the row order — a `row_index` would then count off a page nobody kept");
  assert.match(server, /obligationsSidecarPath\(spec\.output_path\)/,
    "the writer re-derives the sidecar filename instead of importing the one derivation of it");
  assert.equal(obligationsSidecarPath("/run/pr-risk-a.json"),
    "/run/connotation-obligations.pr-risk-a.json");
});
