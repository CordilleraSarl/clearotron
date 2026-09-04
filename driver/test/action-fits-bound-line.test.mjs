// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// — THE CONDITIONS BOX CUT THE ASK ON PUNCTUATION, AND THE CHECK THAT WAS MEANT TO CATCH IT
// MEASURED LENGTH.
//
// The first cut of this issue bound the ask to `CONDITION_HEAD_MAX`, the renderer's own 170-character
// cap, and recorded the cut itself as the owner's call. Putting that choice to him turned up the case
// the length bound never covered — one line ABOVE the cap, and it fires first:
//
//     render.mjs actYouConditions
//     else { const m = t.match(/^[\s\S]*?[.:](?=\s|$)/); head = (m ? m[0] : t).trim(); }  // first sentence
//
// It ends the sentence at the first '.' or ':' before whitespace. So:
//
//     "Obtain consent from Matchday, Inc. before filing in Japan."   (58 chars)
//        delivered as →  "Obtain consent from Matchday, Inc"
//
// Nowhere near any bound. Cut, unmarked, and invisible to a check that measures length. "Inc.", "Ltd.",
// "U.S.", "No. 2" and any internal colon all do it — the words an ask about a company is made of.
//
// OWNER RULING 2026-08-10: STOP CUTTING. The 170 governed two surfaces and one of them, the report
// hero's "subject to" line, was DELETED (render.mjs B1 note). What was left is the email banner's own
// <p>: it wraps, has no width and no clamp, so the cut bought nothing and cost the end of the ask.
//
// THE BOUND SURVIVES SOMEWHERE HONEST. findings-model clips the verdict statement's "conditional on:"
// clause at STATEMENT_CLAUSE_MAX and MARKS the clip with an ellipsis, on a one-row surface that really
// does have a width — the index cell, the run status, the report hero, the email headline, the workbook
// Verdict row. That is where the constant now lives, where the dictation reads it, and what this check
// measures. The check never had to defend a number and still does not: the clip chose it.
//
// BREAK MATRIX:
//   · an ask with "Inc." renders whole          → break: restore the sentence cut, arm 1 goes red
//   · a 255-character ask renders whole         → break: restore the cap, arm 2 goes red
//   · the number lives at the clip, not retyped → break: hardcode 170 in the lint, arm 3 goes red
//   · the check measures `condition ?? text`    → break: measure a.text, arm 4 goes red
//   · EVERY offender is named, not just the lede→ break: measure clauses[0] only, arm 4 goes red
//   · the clip it is founded on is real, and marked → break: drop the ellipsis, arm 5 goes red
//   · the seat is told the surviving bound      → break: drop it from the dictation, arm 6 goes red
//   · advisories and markdown handling unchanged→ break: drop the tag skip, arm 7 goes red
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { actionBoundLineChecks } from "../predelivery-lint.mjs";
import { actYouConditions } from "../publish/render.mjs";
import { STATEMENT_CLAUSE_MAX, riskStatement } from "../findings-model.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const src = (rel) => readFileSync(join(HERE, "..", rel), "utf8");
const live = (rel) => src(rel).split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l.trim())).join("\n");

// The rendered bullet, from the only-you body the email composer parses.
const rendered = (text) => actYouConditions({ body: `- ${text}` })[0] ?? "";

// THE DEFECT, at the length it actually appeared: an ordinary corporate ask, well inside every bound.
const ABBREV = "Obtain consent from Matchday, Inc. before filing in Japan.";
// The delivered shape from the issue: the step, then the reasoning that belonged in the finding.
const LONG = "Instruct Japanese and Korean counsel on the joined-script forms before filing, because the "
  + "register provider could not reach them this run and the risk of a later objection is material given "
  + "the senior filings already on the register in those territories.";
const SHORT = "Instruct Japanese and Korean counsel on the joined-script forms before filing.";

test("#601 arm 1 — an ask that names a company renders to its end", () => {
  assert.ok(ABBREV.length < STATEMENT_CLAUSE_MAX,
    "premise: this is a SHORT ask — no length bound was ever going to catch it");
  assert.equal(rendered(ABBREV), ABBREV,
    'THE DEFECT: "…, Inc." ended the sentence, and the client was shown "Obtain consent from Matchday, Inc"');
  // The three other shapes that hit the same regex, each one word a real ask uses.
  for (const t of ["File in the U.S. before the priority date expires.",
                   "Answer objection No. 2 on the Japanese application.",
                   "Do this first: obtain consent from the senior owner."]) {
    assert.equal(rendered(t), t, `still cut on punctuation: ${t}`);
  }
});

test("#601 arm 2 — a long ask renders whole; nothing is capped and nothing is dropped", () => {
  assert.ok(LONG.length > STATEMENT_CLAUSE_MAX, `premise: ${LONG.length} exceeds the statement's clause bound`);
  assert.equal(rendered(LONG), LONG, "the ask reaches the client entire — the box wraps, it does not cut");
  assert.equal(rendered(SHORT), SHORT, "and a short one is byte-identical to what was authored");
  // The renderer keeps no width of its own — the reason the cut existed is gone with it.
  const r = live("publish/render.mjs");
  assert.ok(!/CONDITION_HEAD_MAX/.test(r), "the render-side bound is deleted, not merely unused");
  const fn = r.slice(r.indexOf("export function actYouConditions"), r.indexOf("export function actYouConditions") + 1200);
  assert.ok(!/\.slice\(0,|\blength >\b/.test(fn), "actYouConditions must not shorten the ask by any route");
  assert.ok(!/\[\.:\]\(\?=/.test(fn), "…including the first-sentence match that caused arm 1");
});

test("#601 arm 3 — the bound is the statement's own clip, and the check reads THAT", () => {
  // One number, defined where the clipping happens. A copy here would drift the first time the clause
  // width changed, and silently in the direction that matters: a check passing an ask the statement cuts.
  const lint = src("predelivery-lint.mjs");
  assert.match(lint, /STATEMENT_CLAUSE_MAX/, "the lint must import the bound");
  assert.match(live("findings-model.mjs"), /export const STATEMENT_CLAUSE_MAX = \d+/,
    "…and findings-model must export it, beside the clipClause call that uses it");
  assert.match(live("findings-model.mjs"), /clipClause\(sentenceCaseLead\(lede\), STATEMENT_CLAUSE_MAX\)/,
    "the clip must USE the constant — an exported number the clip does not read is a decoration");
  const at = live("predelivery-lint.mjs").indexOf("actionBoundLineChecks");
  assert.ok(!/\b170\b/.test(live("predelivery-lint.mjs").slice(at, at + 1400)),
    "the number is retyped in the check — it must come from the clip");
});

test("#601 arm 4 — the check measures what reaches the clause: `condition ?? text`, conditions only", () => {
  // The lede takes conditionClauses = condition ?? text. An action with a typed `condition` is measured
  // on THAT — measuring its ask text would flag an author for a string the statement never renders.
  const short = { id: 1, kind: "consent", text: LONG, condition: "No consent from Matchday, Inc. appears on the record searched", ordinals: [] };
  assert.equal(actionBoundLineChecks([short], [])[0].pass, true,
    "a long ask whose typed condition is short does not reach the clip, so it is not an offender");

  const bare = { id: 2, kind: "consent", text: LONG, ordinals: [] };
  const over = actionBoundLineChecks([bare], []);
  assert.equal(over[0].pass, false, "…and an untyped one puts its ask text straight into the clip");
  assert.match(over[0].detail, /action 2 at 255/, "the offender and its length are named, so the fix is obvious");
  assert.match(over[0].detail, /conditional on:/, "and the detail says WHICH sentence ellipsises it");

  // EVERY offender, not just whichever the register happens to sort first into the lede.
  const two = actionBoundLineChecks([bare, { ...bare, id: 3 }], []);
  assert.match(two[0].detail, /action 2 at 255, action 3 at 255/,
    "which clause leads depends on register order — measuring only the lede passes today and fails on a reorder");

  // Advisory kinds never enter the statement, and nothing shortens them any more.
  assert.equal(actionBoundLineChecks([{ id: 4, kind: "monitoring", text: LONG, ordinals: [] }], [])[0].pass, true,
    "an advisory is not clipped anywhere — flagging it would be a check with nothing behind it");
  assert.equal(actionBoundLineChecks([], []).length, 0, "no register, no check (presence-gated like the rest)");
});

test("#601 arm 5 — the clip this check is founded on is real, and it MARKS the cut", () => {
  // The whole argument for keeping a bound. If this stopped clipping, or clipped silently, the check
  // would be enforcing a rule the product no longer has.
  const st = riskStatement({ tier: "Elevated", verdict: "CONDITIONAL", reasons: [LONG] });
  assert.ok(st.includes("conditional on:"), `premise: the CONDITIONAL statement leads with the clause — got "${st}"`);
  assert.ok(st.includes("…"), "THE JUSTIFICATION: the statement clips an over-long clause and shows that it did");
  assert.ok(!st.includes(LONG), "…so the clause is genuinely shortened on every surface that renders this sentence");
  const fits = riskStatement({ tier: "Elevated", verdict: "CONDITIONAL", reasons: [SHORT] });
  assert.ok(fits.includes(SHORT.replace(/\.$/, "")) && !fits.includes("…"),
    "and an ask inside the bound rides the statement whole");
});

test("#601 arm 6 — the seat authoring the ask is told the surviving bound, and told what it costs", () => {
  const stages = src("stages.mjs");
  assert.match(stages, /\$\{STATEMENT_CLAUSE_MAX\}/,
    "the dictation must interpolate the same constant — a typed number here is the drift arm 3 forbids");
  assert.match(stages, /IT MUST FIT ONE LINE OF THE VERDICT STATEMENT/,
    "a bound the author cannot see is a bound they will keep crossing");
  assert.ok(!/those two client surfaces CUT it/.test(stages),
    "the dictation must not still claim a cut that was deleted — an author held to a false rule writes to it");
  assert.match(stages, /THE ASK IS THE STEP, NOT THE ARGUMENT FOR IT/,
    "the reason the bound exists at all, unchanged by where the bound lives");
});

test("#601 arm 7 — the rewrite kept everything the box was already right about", () => {
  // The cut was one expression inside a function that does four other things. Each of them was fixed
  // for a reason, and a rewrite is exactly where they get lost.
  assert.equal(rendered("**[Open question]** Confirm how the product will be presented"), "",
    "spec 64: an advisory never reads as 'subject to'");
  assert.equal(rendered("**[Time-critical]** Answer the examiner by 2026-09-01"), "Answer the examiner by 2026-09-01",
    "the [Time-critical] tag leaked onto the client verdict line once — it stays stripped");
  assert.equal(rendered("Read the [record](https://example.test/x) and **respond**"), "Read the record and respond",
    "markdown link text and bold survive; the syntax does not");
  assert.equal(rendered("Obtain consent from the senior owner:"), "Obtain consent from the senior owner",
    "a dangling colon introduced a clause this bullet no longer has");
  // The driver's own subject join and deadline suffix now REACH the banner — the sentence cut removed
  // them by accident, and a line headed "subject to:" is where the finding and the date belong.
  assert.equal(rendered("Obtain consent from the senior owner. (re: MATCHDAY) (due by 2026-09-01)"),
    "Obtain consent from the senior owner. (re: MATCHDAY) (due by 2026-09-01)");
});
