// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A placed right is often several registrations of one mark by one owner. The digest may keep one of
// them on a Sheet and give each of the others a Negative-results row saying it adds nothing. The carry
// join read the first such row as the end of the whole right, the kept registration included, and
// synthesis is handed only what that join calls carried: the right never reached the report, and the
// check that names a record synthesis failed to answer owed nothing for it.
//
// Now a registration on a findings surface with no drop row of its own carries its right. A
// registration that has a drop row stays dropped, wherever else it is named, and a right with no
// surviving registration is decided as before. Every arm drives the real join; the findings text is
// the shape the digest's renderer writes.
import test from "node:test";
import assert from "node:assert/strict";
import { parseCarrySurfaces, classifyPlacement, reconcilePlacementCarry } from "../placement-carry.mjs";
import { placementIndex } from "../record-carry.mjs";

const FINDINGS = [
  "# Register findings — QUILLMERE (provider: signa)",
  "",
  "### Incumbent-context (orchestrator: Sheet 2 candidates)",
  "",
  "| URI | Mark | Owner | Reason |",
  "|---|---|---|---|",
  "| /mark/eu/tm_kestreline-eu | KESTRELINE | Kestrel Pharma AG | Same channels; different ending. Completes the record. |",
  "| /mark/us/tm_twinmark-us | TWINMARK | Twin Labs Inc | Listed here and dropped below. |",
  "| /mark/ch/tm_adjmark-ch | ADJMARK | Adj Holdings SA | Completes the record. |",
  "",
  "### Negative results (orchestrator: Sheet \"Negative Results\")",
  "",
  "| Subject | Mark | Reason | Record |",
  "|---|---|---|---|",
  "| KESTRELINE — FR record | KESTRELINE | A copy of the right already on Sheet 2; it adds nothing. | URI /mark/fr/tm_kestreline-fr |",
  "| KESTRELINE — GB record | KESTRELINE | A copy of the right already on Sheet 2; it adds nothing. | URI /mark/gb/tm_kestreline-gb |",
  "| TWINMARK | TWINMARK | Different goods. | URI /mark/us/tm_twinmark-us |",
  "| GONEMARK — EU record | GONEMARK | Different goods. | URI /mark/eu/tm_gonemark-eu |",
  "| GONEMARK — GB record | GONEMARK | Different goods. | URI /mark/gb/tm_gonemark-gb |",
  "",
  "### Disagreement resolutions",
  "",
  "- /mark/ch/tm_adjmark-ch2 — **ADOPTED**: a copy of the ADJMARK right; it follows that right's placement.",
  "",
].join("\n");

const placement = (mark, tier, records) => ({ mark, owner: `${mark} owner`, jurisdiction: "EU", tier, records, reason: "placed" });

// The kept registration is listed last, as a run's placements list it: the order must not matter.
const KESTRELINE = placement("KESTRELINE", "sheet-2", ["/mark/fr/tm_kestreline-fr", "/mark/gb/tm_kestreline-gb", "/mark/eu/tm_kestreline-eu"]);
const TWINMARK = placement("TWINMARK", "sheet-2", ["/mark/us/tm_twinmark-us"]);
const GONEMARK = placement("GONEMARK", "headline-candidate", ["/mark/eu/tm_gonemark-eu", "/mark/gb/tm_gonemark-gb"]);
const ADJMARK = placement("ADJMARK", "sheet-2", ["/mark/ch/tm_adjmark-ch", "/mark/ch/tm_adjmark-ch2"]);

const surfaces = parseCarrySurfaces(FINDINGS);

test("CONTROL: the fixture puts the right's copies on the drop surface and its kept registration on a Sheet", () => {
  assert.equal(surfaces.uris["reasoned-negative"].has("/mark/fr/tm_kestreline-fr"), true);
  assert.equal(surfaces.uris["reasoned-negative"].has("/mark/gb/tm_kestreline-gb"), true);
  assert.equal(surfaces.uris.carried.has("/mark/eu/tm_kestreline-eu"), true);
  assert.equal(surfaces.uris["reasoned-negative"].has("/mark/eu/tm_kestreline-eu"), false,
    "the kept registration has no drop row of its own, which is the case under test");
});

test("a right kept on a Sheet is carried, though its copies have drop rows", () => {
  const c = classifyPlacement(KESTRELINE, surfaces);
  assert.equal(c.class, "carried", `the right was read as ${c.class}, ended by ${c.ended_by}`);
  assert.equal(c.ended_by, "/mark/eu/tm_kestreline-eu", "it is carried by the registration the digest kept");
});

test("synthesis is handed every registration of that right", () => {
  const idx = placementIndex([KESTRELINE, TWINMARK, GONEMARK, ADJMARK], FINDINGS);
  for (const uri of KESTRELINE.records) {
    assert.equal(idx.get(uri)?.carry, "carried", `${uri} is left off the list synthesis answers`);
  }
});

test("a registration with its own drop row stays dropped, even where a Sheet also names it", () => {
  assert.equal(classifyPlacement(TWINMARK, surfaces).class, "reasoned-negative");
  assert.equal(placementIndex([TWINMARK], FINDINGS).get("/mark/us/tm_twinmark-us")?.carry, "reasoned-negative");
});

test("a right with no surviving registration is dropped, as before", () => {
  const c = classifyPlacement(GONEMARK, surfaces);
  assert.equal(c.class, "reasoned-negative");
  assert.equal(c.ended_by, "/mark/eu/tm_gonemark-eu");
});

test("a right kept on a Sheet with a copy settled in a Disagreement-resolutions row is carried, as before", () => {
  assert.equal(classifyPlacement(ADJMARK, surfaces).class, "carried");
});

test("the placement-carry counts agree with the list synthesis is handed", () => {
  const r = reconcilePlacementCarry({ placements: [KESTRELINE, TWINMARK, GONEMARK, ADJMARK], registerFindingsText: FINDINGS });
  assert.equal(r.totals.carried, 2, JSON.stringify(r.totals));
  assert.equal(r.totals.reasoned_negative, 2, JSON.stringify(r.totals));
  assert.equal(r.rows.find((row) => row.mark === "KESTRELINE")?.class, "carried");
});
