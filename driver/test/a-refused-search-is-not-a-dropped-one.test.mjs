// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// A SEARCH THE PROVIDER REFUSED IS NOT A SEARCH THAT WAS DROPPED.
//
// Found driving 673's gate offline on 0.3.2-beta.10. `audit.md` tells the two apart; the audit workbook
// did not. It grouped each term's rows and collected their notes into `g.notes`, and nothing ever read
// that — so a query a provider refused, with the provider's own words in hand, rendered as
//
//     could not be searched | Open — not searched | Not checked on any recorded surface…
//
// which is the same sentence a query that was never run gets. The reason had reached this file and was
// thrown away one line later.
//
// The two are different facts and a reader acts on them differently: a content-policy refusal will
// refuse again, and a query that never ran may simply run. So the words the surface gave are quoted,
// and where nothing was recorded the row says that rather than implying a reason it does not have.
//
// THE CLIENT REPORT IS NOT TOUCHED. The other half of the filing — that report.html shows neither
// deterministically, because its coverage rows are written by the synthesis model — is a separate
// question about that surface, not about this one.
//
// Driven through `searchRows`, the function the workbook builds from, on rows shaped the way
// `audit-from-spine` shapes them: the typed `not_searched` marker and the gap's reason in `notes`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { searchRows } from "../publish/xlsx.mjs";

const TERM = "LUMENGARDE";
const row = (over) => ({ source_layer: "Common-law", search_term: TERM, platform: "etsy", result: "No relevant result", notes: "", ...over });
const gap = (platform, notes) => row({ platform, result: "Could not be searched", notes, not_searched: true });
const noteFor = (negs, term = TERM) =>
  searchRows({ negatives: negs }, {}).find((r) => r["Search term / variant"] === term)?.Note ?? "";

test("a provider's refusal reaches the workbook in the provider's own words", () => {
  const note = noteFor([row({}), gap("connotation", "provider refused the query: content policy (HTTP 400)")]);
  assert.match(note, /could not be searched \(connotation\)/, "the gap itself is no longer stated");
  // THE DEFECT, as the assertion: the reason was collected and dropped.
  assert.match(note, /gave a reason/, "the workbook still says nothing about why the surface refused");
  assert.match(note, /content policy/, "the provider's own reason did not reach the workbook");
});

test("a search that was dropped says so, rather than borrowing a reason", () => {
  const note = noteFor([gap("reddit", "")]);
  assert.match(note, /No reason was recorded/, "a gap with no recorded reason does not say so");
  assert.doesNotMatch(note, /gave a reason/, "a dropped search is described as though the surface answered");
});

test("the two read differently on the same page, which is the whole point", () => {
  // Both terms in one workbook: a reader comparing them must be able to tell which is which, since the
  // old rendering gave them the identical sentence.
  const negs = [
    gap("connotation", "provider refused the query: content policy (HTTP 400)"),
    { ...gap("reddit", ""), search_term: "DAWNGARDE" },
  ];
  const refused = noteFor(negs, TERM);
  const dropped = noteFor(negs, "DAWNGARDE");
  assert.notEqual(refused, dropped, "a refused search and a dropped one still render as the same sentence");
  assert.match(refused, /content policy/);
  assert.match(dropped, /No reason was recorded/);
});

test("a term whose surfaces all answered gains nothing — the clean row is unchanged", () => {
  // A workbook that annotates every clean line teaches the reader to ignore the annotation, which is
  // the rule this file already states for the "of N" suffix.
  const note = noteFor([row({}), row({ platform: "reddit" })]);
  assert.doesNotMatch(note, /gave a reason|No reason was recorded|could not be searched/,
    "a term with no gaps now carries gap prose");
});

test("several refusing surfaces are each named with what they said", () => {
  const note = noteFor([
    gap("connotation", "provider refused the query: content policy (HTTP 400)"),
    gap("marketplace", "rate limited, not retried"),
  ]);
  for (const fragment of ["connotation", "content policy", "marketplace", "rate limited"])
    assert.ok(note.includes(fragment), `the note lost ${JSON.stringify(fragment)}: ${note}`);
});

test("a mix of reasoned and silent gaps counts the silent ones rather than implying they spoke", () => {
  const note = noteFor([
    gap("connotation", "provider refused the query: content policy (HTTP 400)"),
    gap("reddit", ""),
  ]);
  assert.match(note, /content policy/, "the surface that gave a reason lost it");
  assert.match(note, /1 recorded no reason \(reddit\)/, "the silent surface is folded in with the one that spoke");
});
