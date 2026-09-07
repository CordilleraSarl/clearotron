// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// A promoted register card never carries a rating and a denial of one at the same time.
//
// TWO RULINGS MEET ON THIS CARD AND THEY ALMOST CONTRADICTED EACH OTHER IN THE CLIENT'S VOICE.
//
// The first retired a code-owned placeholder from the card's band slot, because a word the product
// chose is a rating nobody performed. What replaced it is a neutral sentence describing the card:
// "Register listing — this card carries no rating of its own".
//
// The second ruled that where the rater DID weigh a promoted filing, that band belongs on the card —
// a filing weighed into the verdict was rendering as though it had not been, beside neighbours that
// showed theirs.
//
// Both hold, and they hold over different cards. The defect was that the band and the read arrive as
// INDEPENDENT fields on the same row: the band comes from `registerReads[].band` and the read from
// `registerReads[].read`. A rater who banded a filing without typing a read is an ordinary case, and it
// rendered the band chip beside the sentence saying the card carries no rating. One card, both claims.
//
// DRIVEN ON THE RENDERER, NOT ON THE HELPER. The first control written for this passed `registerReads`
// with no `registerRecords`, so no register card rendered at all and the before and after read
// identical — a control that cannot reproduce the defect is a stop, not a clean bill.
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderKnockoutHtml, NOT_WEIGHED_LINE } from "../publish/render-knockout.mjs";

const FRAMEWORK = { bands: [{ label: "High", tone: "high" }, { label: "Low", tone: "low" }] };

// The driver's own record sidecar. `promotableRecords` filters THIS; the rater's reads join to it by
// recordId, so a card cannot exist without a record the run actually holds.
const RECORDS = {
  marks: [{
    name: "BRIMSTONE", classes: [9],
    records: [{ recordId: "EU-901", mark: "BRIMSTONE REG", owner: "Someone GmbH", territory: "EU",
      classes: [9], status: "registered", url: "https://example.test/EU-901" }],
  }],
};

const render = (band, read) => renderKnockoutHtml({
  batch: { overall: "High", executiveSummary: "summary" },
  marks: [{
    name: "BRIMSTONE", rating: "High", basis: "a basis", classesSearched: [9], findings: [],
    registerReads: [{ recordId: "EU-901", band, read }],
  }],
}, FRAMEWORK, { runId: "r1", overall: "High", registerRecords: RECORDS });

const CHIP = /ko-findband/;

// THE REGISTER CARD ONLY. `/ko-findband/` over the whole document matches the MARK's own chip, so an
// assertion written that way passes with the register card's chip deleted — which is how the first
// version of the arm below was vacuous. Every chip claim here is scoped to the card under test.
const registerCard = (html) => {
  const at = html.indexOf("BRIMSTONE REG");
  if (at < 0) return "";
  const start = html.lastIndexOf('<div class="card ko-find"', at);
  return html.slice(start, html.indexOf("</div></div>", at) + 12);
};

test("274/1935: a BANDED register card does not also say it carries no rating", () => {
  const html = render("High", "");
  assert.ok(html.includes("BRIMSTONE REG"), "precondition: the register card rendered at all");
  assert.match(registerCard(html), CHIP,
    "the rater's band is not on the REGISTER card, which is what the later ruling requires");
  assert.ok(!html.includes(NOT_WEIGHED_LINE),
    "the card shows a rating AND the sentence denying it has one. A reader is told both in one card, in "
    + "our voice, on a page a client reads");
});

test("274/1935: an UNBANDED register card keeps the neutral line and wears no chip", () => {
  const html = render(null, "");
  assert.ok(html.includes("BRIMSTONE REG"), "precondition: the card rendered");
  assert.ok(html.includes(NOT_WEIGHED_LINE),
    "the neutral line is gone from a card that genuinely carries no rating — which is the state it was "
    + "written for, and dropping it leaves the anatomy silent about why this card has no band");
  assert.doesNotMatch(registerCard(html), CHIP,
    "an unbanded card wears a chip — a rating nobody performed, which is the earlier ruling exactly");
});

test("274/1935: the rater's own read replaces the neutral line, banded or not", () => {
  for (const band of ["High", null]) {
    const html = render(band, "the rater weighed this filing into the verdict");
    assert.ok(html.includes("the rater weighed this filing into the verdict"),
      `band=${band}: the rater's read did not reach the card, which is the whole point of promoting it`);
    assert.ok(!html.includes(NOT_WEIGHED_LINE),
      `band=${band}: the card carries a read and still says it carries no rating of its own`);
  }
});
