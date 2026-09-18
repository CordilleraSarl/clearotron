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
//   · a pre-split reason renders as the lawyer's       → break: return the reason, arm 7 red
//   · one composer serves both entry points            → break: spell the sentence twice, arm 8 red
//   · a reason nobody can render leaves a trace        → break: drop it silently, arm 9 red
//
// THE DROP IS THE PART TO READ TWICE. A token-bearing reason with no clause and no composable sentence
// no longer reaches the page — which also stops the voice lint flagging it, because the page is clean.
// That is a gap closed and a disclosure closed with it, and only the second check tells them apart. So
// arm 9 asserts the POPULATION as well as the absence: a `clientConditions` that returned nothing at
// all would satisfy "the token is gone" and is the defect, not the fix.
import { test } from "node:test";
process.env.CLEAROTRON_MCP_URL ||= "https://mcp.test/mcp";
import assert from "node:assert/strict";
import { clientConditions, clauseForDefect, clauseFromReason, unrenderableConditions, ENGINE_TOKEN_RE } from "../terminal-clamp.mjs";
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
  // match wearing a rule's name. THE ROUTE CHANGED AND THE PROPERTY DID NOT. A token-bearing reason with
  // no clause is now dropped before it renders, so the surface a lint can flag is reached by a STORED
  // clause carrying a token — the machinery sites push free text as their own clause and nothing on that
  // path passes through `terminalClampDecision`. Planting the old route here would drive a surface that
  // no longer exists and pass whatever the lint did.
  const reason = "records_unscreened:12 of 88 rows — the band gave the seat nothing to name";
  const clause = "12 of the 88 records read were not individually screened in this report";
  const fused = clientConditionVoiceChecks({ verdictDoc: { reasons: [reason], clauses: [reason] } });
  assert.equal(fused[0].pass, false, "a delivered condition carrying an engine identifier passed the lint");
  assert.match(fused[0].detail, /records_unscreened:12/, "the flag does not name the identifier it found");
  const fixed = clientConditionVoiceChecks({ verdictDoc: { reasons: [reason], clauses: [clause] } });
  assert.equal(fixed[0].pass, true, "the lint still flags a run whose conditions now read the clause — it is not reading the surface");
});

test("a pre-split reason renders as the lawyer's sentence, not as the run record", () => {
  // The defect this file is named for, on the run shape that actually produced it: an archived run
  // carries reasons and no clauses, and its report is republished from that sidecar unchanged.
  const out = clientConditions({ reasons: [TOKEN_REASON] });
  assert.equal(out.length, 1, "the condition was dropped — a reason whose sentence IS composable must still reach the client");
  assert.equal(out[0], clauseForDefect("floor_duty_undischarged", 4, 430),
    "the republished sentence is not the one the clamp site composes for a fresh run");
  assert.ok(out[0].startsWith(TOKEN_CLAUSE), "the composed sentence is not the clause the clamp site writes");
  assert.doesNotMatch(out[0], /floor_duty_undischarged/, "the client's condition still opens with the engine's identifier");
});

test("one composer serves the clamp site and the republish path", () => {
  // TWO ENTRY POINTS, ONE SENTENCE. The clamp site has the counts; the republish path has only the
  // reason. A second spelling of either sentence would drift, and both surfaces would still render —
  // only a reader holding a fresh run beside a republished one would ever see it.
  for (const [defect, n, m, reason] of [
    ["floor_duty_undischarged", 4, 430, TOKEN_REASON],
    ["synthesis_unaccounted_delivered", 2, 17, "synthesis_unaccounted_delivered:2 of 17 record(s) reached the findings surface and the delivered document accounts for none of them"],
  ]) {
    const fromCounts = clauseForDefect(defect, n, m);
    assert.ok(fromCounts, `${defect} has no sentence in the clause authority`);
    assert.equal(clauseFromReason(reason), fromCounts, `${defect}: the republish path composes a different sentence from the clamp site`);
    // THE MODULE'S OWN SHAPE, not a second spelling of it: a narrowing of `ENGINE_TOKEN_RE` would
    // never reach a copy written here, and this arm would go on passing against the old definition.
    assert.doesNotMatch(fromCounts, ENGINE_TOKEN_RE, `${defect}: the composed client sentence carries an engine identifier`);
  }
});

test("a reason nobody can render is dropped from the page and reported to the operator", () => {
  // THE POPULATION IS ASSERTED, NOT ONLY THE ABSENCE. "The token is gone" is also true of a function
  // that returns nothing at all, which is why the clean condition rides along and is checked by name.
  const unknown = "records_unscreened:12 of 88 rows — the band gave the seat nothing to name";
  const doc = { reasons: [ASK_REASON, unknown] };
  const out = clientConditions(doc);
  assert.deepEqual(out, [ASK_REASON], "the surviving condition went too — this drops more than the unrenderable one");
  assert.deepEqual(unrenderableConditions(doc), [unknown], "the dropped condition is not reported, so the disclosure closed silently");
  const checks = clientConditionVoiceChecks({ verdictDoc: doc });
  assert.equal(checks[0].pass, true, "the page is clean and the voice check says otherwise");
  const droppedCheck = checks.find((c) => c.id === "client-condition-dropped");
  assert.ok(droppedCheck, "no check reports a condition that reached no client surface");
  assert.equal(droppedCheck.pass, false, "a condition that reaches nobody passed the lint");
  assert.match(droppedCheck.detail, /records_unscreened:12/, "the flag does not name the condition it lost");
  // The clean run says nothing — a check that fires on every run is not a measurement.
  const clean = clientConditionVoiceChecks({ verdictDoc: { reasons: [ASK_REASON] } });
  assert.equal(clean.find((c) => c.id === "client-condition-dropped").pass, true, "the dropped check fires on a run that dropped nothing");
});

test("an unfinished register search reaches the verdict without the engine's axis names", async () => {
  // The coverage-floor clamp wrote "register coverage deferred on primary-sweep — …" as both the run
  // record's sentence and the client's. The axis name is the engine's filing label for a slice; it comes
  // OUT of the client's clause and nothing is written in its place (ruled 2026-09-18).
  const { registerGapConditions } = await import("../pipeline.mjs");
  const { REGISTER_AXES } = await import("../coverage-ledger.mjs");
  const { clientConditions } = await import("../terminal-clamp.mjs");
  const rows = registerGapConditions({ deferred: [{ axis: "primary-sweep" }, { axis: "incumbent-class" }], taintAxes: ["transliteration-numeric"] });
  assert.equal(rows.length, 2);
  for (const { reason, clause } of rows) {
    assert.ok(REGISTER_AXES.some((a) => reason.includes(a)), "the run record keeps the axes for whoever repairs the run");
    assert.ok(!REGISTER_AXES.some((a) => clause.includes(a)), `no axis name in the client's clause: ${clause}`);
  }
  // The clause is the reason's own words with the axis names taken out, and nothing written in.
  assert.equal(rows[0].reason, "register coverage deferred on primary-sweep, incumbent-class — the search did not finish and must be re-run before this can be relied on");
  assert.equal(rows[0].clause, "register coverage deferred — the search did not finish and must be re-run before this can be relied on");
  assert.equal(rows[1].reason, "the transliteration-numeric register pass was cut down at the timeout wall and its self-reported coverage is unverified");
  assert.equal(rows[1].clause, "the register pass was cut down at the timeout wall and its self-reported coverage is unverified");
  const shown = clientConditions({ reasons: rows.map((r) => r.reason), clauses: rows.map((r) => r.clause) });
  assert.ok(shown.length === 2 && !shown.some((c) => REGISTER_AXES.some((a) => c.includes(a))), JSON.stringify(shown));
  assert.deepEqual(registerGapConditions({ deferred: [], taintAxes: [] }), [], "no gap, no condition");
});
