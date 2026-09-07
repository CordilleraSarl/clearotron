// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// The connector OFFERS the memo, and offers it to the audience whose door serves it (tracker issue 315).
//
// WHAT WAS WRONG. The memo engine was finished and verified. The assistant briefing never mentioned it,
// so the capability shipped dark: an assistant reading the account pack was told "a what-if re-runs one
// step of a finished search", asked for exactly that on a delivered report, and got back "what-if runs on
// live runs only". The honest-sounding answer it then gave the user — commission a fresh search — is the
// answer the memo exists to replace.
//
// WHY THESE ARMS READ THE SERVED TEXT AND NOT THE FILE. `instructionsFor` is what a connecting assistant
// actually receives: it strips frontmatter, it caches, and it falls back between packs. A test that read
// skills/clearotron-account/SKILL.md off disk would pass while the thing sent over MCP said something
// else, which is the shape the one-copy arm next door already exists to catch.
//
// AND WHY THEY ARE JOINED TO THE ENGINE. Prose asserted against prose is a spell-check. Every bound the
// skill states is asserted here against what whatIfPlan actually returns for the same run, so skill text
// that overstates a limit — or an engine that quietly stops keeping one — reds this file rather than
// reaching a client as a promise nobody checks.
import { test } from "node:test";
import assert from "node:assert/strict";
import { instructionsFor } from "../../mcp-server/lib/instructions.mjs";
import { whatIfPlan } from "../../mcp-server/lib/whatif.mjs";
import { visibleTools } from "../../shared/scope.mjs";
import { STAGE_ORDER } from "../stages.mjs";

// WRAPPED PROSE IS STILL ONE SENTENCE. These files are hand-wrapped at ~100 columns, so a sentence the
// briefing states runs across a newline and a regex with a literal space in it misses text that is
// present — a red that says the instruction is absent when it is there, which is worse than no arm. The
// first draft of this file failed exactly that way. Whitespace is collapsed before matching, so an
// assertion is about what the sentence SAYS and not about where the author happened to break the line.
const flat = (s) => String(s ?? "").replace(/\s+/g, " ");
const accountPack = () => flat(instructionsFor({ kind: "account" }));
const clientPack = () => flat(instructionsFor({ kind: "user" }));

// A delivered, archived run — the state the memo exists for. whatIfPlan is pure over a resolved run, so
// this is the real planner, not a stand-in for it.
const delivered = {
  runId: "r-315", slug: "s", codename: "c", agent: "a", runDir: "/nonexistent",
  P: {}, status: "delivered", state: "delivered", location: "archive",
};
const ASSUMPTION = "the Korean application were abandoned";

test("tracker issue 315 the account briefing names the memo and ties it to a DELIVERED report", () => {
  const pack = accountPack();
  assert.ok(pack.length > 0, "no account briefing was served at all — every arm below would pass vacuously");
  assert.match(pack, /\bmemo\b/i,
    "the served account briefing never says 'memo', so an assistant has no name for the capability");
  assert.match(pack, /delivered or archived/i,
    "the briefing does not tie the memo to the state that makes it the only option — an assistant that "
    + "does not know WHEN to offer it will keep asking for the step re-run that gets refused");
});

test("tracker issue 315 the briefing tells the assistant to check the state before refusing", () => {
  // The failure this issue was filed on is a refusal, not a wrong answer. The instruction that prevents
  // it has to be about checking, not about the memo existing somewhere in the document.
  assert.match(accountPack(), /before you tell anyone the question cannot be answered/i,
    "nothing instructs the assistant to check the search's state before saying no — which is the exact "
    + "moment the old behaviour happened");
});

// ── THE JOIN: every bound the skill states is the engine's own ───────────────────────────────────────

test("tracker issue 315 the refusal the briefing warns about is the refusal the engine actually gives", () => {
  const plan = whatIfPlan({ run: delivered, stage: STAGE_ORDER[0], instructions: ASSUMPTION });
  assert.equal(plan.runnable, false, "a step re-run on a delivered run is supposed to be refused");
  assert.match(plan.reason, /live runs only/i,
    "the engine's refusal changed wording; the briefing tells the assistant a step re-run is refused on a "
    + "delivered report, so the two have drifted");
});

test("tracker issue 315 the memo the briefing offers is the memo the engine admits", () => {
  const plan = whatIfPlan({ run: delivered, kind: "memo", instructions: ASSUMPTION });
  assert.equal(plan.runnable, true,
    "the briefing now tells assistants to offer a memo on a delivered report and the engine refuses one");
  assert.equal(plan.kind, "memo");
});

test("tracker issue 315 the three bounds the briefing states are the ones the engine keeps", () => {
  const plan = whatIfPlan({ run: delivered, kind: "memo", instructions: ASSUMPTION });
  const pack = accountPack();

  // 1. It searches nothing.
  assert.match(plan.externalCalls, /no searching/i, "the engine stopped claiming a memo searches nothing");
  assert.match(pack, /searches nothing/i,
    "the briefing dropped the no-searching bound, which is half of why this is safe to offer on a "
    + "delivered report");

  // 2. The report is untouched.
  assert.equal(plan.affectsFinalReport, false, "the engine now says a memo affects the final report");
  assert.match(pack, /Neither kind edits the delivered search or its report/i,
    "the briefing dropped the report-untouched bound");

  // 3. It cannot confirm the assumption — the bound most likely to be read off as a finding.
  assert.match(plan.honestyNote, /cannot confirm the assumption itself/i,
    "the engine's honesty note stopped saying a memo cannot confirm the assumption");
  assert.match(pack, /cannot confirm the assumption/i,
    "the briefing dropped the bound that stops a memo being relayed as a finding — the one that turns "
    + "'what this would mean IF' into 'this is what happened'");
});

// ── THE AUDIENCE, WHICH IS THE HALF THE ISSUE GOT WRONG ──────────────────────────────────────────────

test("tracker issue 315 the report-link door does NOT serve the memo, so its briefing must not offer one", () => {
  // The issue asked for this in the client pack. Its audience cannot call the tools at all, and a
  // briefing that offers what the door refuses is the defect the grant-sentence arm exists to catch.
  const clientSees = visibleTools({ kind: "user", local: false });
  assert.equal(clientSees("what_if_plan"), false, "premise: a report-link principal cannot plan a what-if");
  assert.equal(clientSees("what_if_run"), false, "premise: nor run one");

  const pack = clientPack();
  assert.ok(pack.length > 0, "no client briefing was served — the arm below would pass on an empty string");
  assert.ok(!/\bmemo\b/i.test(pack),
    "the client briefing offers a memo to an audience whose own door refuses it. If the memo is meant to "
    + "reach report-link clients, the fix is clientSafe on the tool scopes, not a sentence in a skill");
});

test("tracker issue 315 the account door DOES serve it — the briefing and the gate agree", () => {
  const accountSees = visibleTools({ kind: "account", local: false });
  assert.equal(accountSees("what_if_plan"), true,
    "the account door stopped serving what_if_plan, so the briefing above now offers a capability this "
    + "audience cannot reach either");
  assert.equal(accountSees("what_if_run"), true, "and the same for running it");
});
