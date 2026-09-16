// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// ── THE CONDITIONS A CLIENT READS ARE THE READER'S SENTENCES ────────────────────────────────────────
//
// Every clamp site composes TWO texts: a run-record `reason` that may name tokens, counts and record
// ids, and a `clause` saying the same fact in a lawyer's nouns. `terminalClampDecision` refuses a clause
// carrying an engine identifier, so the clean text was always being written. The sidecar then persisted
// `reasons` alone and dropped the clauses, and every client surface rendered the run record: a delivered
// report opened its conditions with `floor_duty_undischarged:4 of 430 floor row(s)…` while the SAME
// run's risk statement, composed one line earlier from the clauses, read the clean sentence. The page
// contradicted its own headline.
//
// THESE ARMS DRIVE THE DOOR, NOT THE HELPER ALONE. Two of them go through `clearanceReportData`, which
// is what actually builds the client's `verdict.conditions`, because a helper can be correct while
// nothing calls it — the shape this whole defect had.
//
// TWO DIFFERENT TOKENS, because the file name says "never". One member of a class proves nothing about
// the class, so the substitution arm and the lint arm use different identifiers.
//
// BREAK MATRIX:
//   · a clause replaces its token-bearing reason        → break: return reasons unchanged, arm 1 + 5 red
//   · a clean reason with no clause survives VERBATIM   → break: return "" for a missing clause, arm 2 red
//   · a legacy sidecar still yields its conditions      → break: require the clauses key, arm 3 red
//   · clauses shorter than reasons loses nothing        → break: map over clauses, arm 4 red
//   · the lint sees what the surface renders            → break: read either array directly, arm 6 red
import { test } from "node:test";
process.env.CLEAROTRON_MCP_URL ||= "https://mcp.test/mcp";
import assert from "node:assert/strict";
import { clientConditions } from "../terminal-clamp.mjs";
import { clientConditionVoiceChecks } from "../predelivery-lint.mjs";
import { clearanceReportData } from "../publish/report-data.mjs";

// Invented ground throughout. No client content reaches a fixture.
const TOKEN_REASON = "floor_duty_undischarged:4 of 430 floor row(s) — each is placed at any tier, or named by its record id";
const TOKEN_CLAUSE = "4 of the 430 live registrations identical or near-identical to the mark are not individually addressed in this report";
const ASK_REASON = "Ask EU counsel whether the earlier QORI word marks could be raised against VENQORI read as one word.";

test("the reader's clause replaces the run-record reason that carries a token", () => {
  const out = clientConditions({ reasons: [TOKEN_REASON], clauses: [TOKEN_CLAUSE] });
  assert.deepEqual(out, [TOKEN_CLAUSE],
    "the client's condition is still the run-record sentence — the clause the clamp site wrote was discarded again");
});

test("a condition with no separate clause survives verbatim", () => {
  // THE ANTI-REGRESSION ARM. Three machinery sites push the reason AS the clause, and many conditions
  // are the author's own ask text. Preferring a clause that does not exist would silently rewrite every
  // one of them — a voice change across every delivered report, wearing this fix as cover.
  const out = clientConditions({ reasons: [ASK_REASON], clauses: [""] });
  assert.deepEqual(out, [ASK_REASON], "a condition with no second text was dropped or blanked");
});

test("a legacy sidecar with no clauses key still yields every condition", () => {
  // Archived runs are republished from their own sidecar, written before clauses were persisted.
  const out = clientConditions({ reasons: [ASK_REASON, TOKEN_REASON] });
  assert.equal(out.length, 2, "a sidecar written before this change lost its conditions — archived runs stop republishing");
  assert.equal(out[0], ASK_REASON);
});

test("clauses shorter than reasons loses nothing", () => {
  // A BLOCKING verdict appends its grounds to the reasons ALONE, so the arrays are legitimately
  // different lengths. Mapping over clauses would drop the appended grounds and nothing would say so.
  const out = clientConditions({ reasons: [TOKEN_REASON, ASK_REASON, "A third ground the review cited."], clauses: [TOKEN_CLAUSE] });
  assert.equal(out.length, 3, `3 reasons in, ${out.length} conditions out — the entries past the clauses array were dropped`);
  assert.deepEqual(out.slice(1), [ASK_REASON, "A third ground the review cited."]);
});

test("the report's own client conditions take the clause", () => {
  const data = clearanceReportData({
    verdictInfo: { verdict: "CONDITIONAL", tier: "Moderate", statement: "Moderate — conditional on: something.",
      reasons: [TOKEN_REASON, ASK_REASON], clauses: [TOKEN_CLAUSE, ""] },
  });
  assert.deepEqual(data.verdict.conditions, [TOKEN_CLAUSE, ASK_REASON],
    "the delivered data file still carries the run-record sentence — the door does not call the helper");
});

test("the lint reads what the surface renders, in both directions", () => {
  // A DIFFERENT TOKEN from the arms above: if the check only ever saw floor_duty it would be a string
  // match wearing a rule's name.
  const reason = "records_unscreened:12 of 88 rows — the band gave the seat nothing to name";
  const clause = "12 of the 88 records read were not individually screened in this report";
  const legacy = clientConditionVoiceChecks({ verdictDoc: { reasons: [reason] } });
  assert.equal(legacy[0].pass, false, "a delivered condition carrying an engine identifier passed the lint");
  assert.match(legacy[0].detail, /records_unscreened:12/, "the flag does not name the identifier it found");
  const fixed = clientConditionVoiceChecks({ verdictDoc: { reasons: [reason], clauses: [clause] } });
  assert.equal(fixed[0].pass, true, "the lint still flags a run whose conditions now read the clause — it is not reading the surface");
});
