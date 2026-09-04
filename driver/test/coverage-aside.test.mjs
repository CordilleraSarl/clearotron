// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// (b) — A DELIVERED REPORT EXPLAINED, IN ENGINE WORDS, SOMETHING IT HAD ALREADY SAID TWICE.
//
//     "The joined-script forms … could not be put to the register provider this run"
//
// Three things wrong with one sentence:
//   · "put to the register provider" is engine vocabulary — a lawyer does not have a register provider.
//   · the coverage line, computed from the run record and stamped by code, ALREADY states the gap:
//     "the remaining 23 are non-Latin script forms".
//   · the action list two paragraphs above ALREADY tells the reader to instruct JP/KR counsel for
//     those exact forms. The aside carries nothing the reader did not have.
//
// THE SENTENCE IS IN NO RENDERER. It is model-authored prose, so the fix is the instruction — and the
// instruction already carried the right rule for NUMBERS ("the numbers are code's… Carry the substance,
// drop the number") and stopped one word short of the fact. This extends the rule it already has rather
// than adding a new one, which is why it lands in the same paragraph.
//
// BREAK MATRIX:
//   · the rule is stated where the seat reads it   → break: delete the paragraph, arm 1 goes red
//   · it names the sentence that shipped           → break: generalise it away, arm 2 goes red
//   · it keeps the ACTION and cuts only the aside  → break: word it as "drop both", arm 3 goes red
//   · the driver's own wording is unchanged        → break: reword remainderBuckets, arm 4 goes red
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { deriveScopeFacts } from "../scope-facts.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const RULES = readFileSync(join(HERE, "..", "skills", "prelim-search", "synthesis-rules.md"), "utf8");
// ~100-column hard wrap means a sentence is split across lines in the source; the seat reads it as one.
const FLAT = RULES.replace(/\s+/g, " ");

test("#601b arm 1 — the rule is where the seat writing the coverage prose reads it", () => {
  assert.match(FLAT, /The same rule covers the FACT, not only the number/,
    "the coverage-prose rule stopped at numbers, and the fact walked through the gap");
  // …and it sits with the number rule it extends, not in a paragraph of its own somewhere else.
  const numberRule = FLAT.indexOf("Carry the substance, drop the number");
  const factRule = FLAT.indexOf("The same rule covers the FACT");
  assert.ok(numberRule > 0 && factRule > numberRule && factRule - numberRule < 400,
    "the extension must sit with the rule it extends, or it reads as an unrelated instruction");
});

test("#601b arm 2 — it names the sentence that shipped, and the vocabulary that made it engine-speak", () => {
  assert.match(FLAT, /could not be put to the register provider/,
    "a rule that does not name the failure is a rule nobody can check themselves against");
  assert.match(FLAT, /Never name the provider, the dispatch or the run in a coverage aside/,
    "the ban must name the vocabulary, not gesture at 'engine words'");
});

test("#601b arm 3 — the ACTION survives; only the aside is cut", () => {
  assert.match(FLAT, /keep the action, cut the aside/i,
    "THE TRADE: the reader still needs to be told to instruct counsel — that is the useful half");
  assert.ok(!/drop the action|remove the action/i.test(FLAT),
    "a rule that cuts the action removes the only thing the reader can act on");
});

test("#601b arm 4 — the driver's own wording for the same gap is unchanged and still plain", () => {
  // The aside was redundant against THIS, so if this stopped saying it the rule would be cutting the
  // only statement of the gap.
  const f = deriveScopeFacts({
    instructedScope: { classes: ["9"], jurisdictions: ["US"] },
    // the script-form read is off the plan entry's own TERM, never a vendor field — so the fixture
    // carries a real non-Latin term rather than a reason string that says so.
    plan: { nice_classes: ["9"], entries: [
      { qid: "a", nice_classes: ["9"], term: "MOONBERRY" },
      { qid: "b", nice_classes: ["9"], term: "月莓" } ] },
    planExecution: { executed: [{ qid: "a", state: "enumerated" }], missing: [], skipped: [],
      deferred: [{ qid: "b", reason: "script form not supported by the provider" }] },
    coverageRows: [],
  });
  assert.match(f.coverage_line, /non-Latin script form/,
    "the coverage line must still state the gap the aside was repeating");
  assert.ok(!/provider|dispatch|slice/i.test(f.coverage_line),
    "…and state it without the vocabulary the aside was banned for");
});
