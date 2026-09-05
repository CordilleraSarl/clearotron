// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// What the connector hands an assistant — tracker issue 148.
//
// Three defects, all driven on the live ops connector by the owner on 2026-09-04:
//
//   1. No tool declared MCP annotations, so a client could not tell `brief` from `start_run` and asked
//      before every call. Owner: "it prompts all the time." The cost is not the friction — it is that a
//      user who approves twenty reads in a row learns to approve `start_run`, which spends real money,
//      without reading it.
//   2. The ops briefing told the assistant twice to see `COURIER.md`, which the connector never served.
//      It reported "checking a suspicious reference to a nonexistent skill."
//   3. The cowork row said "Choose API key" — a control that dialog does not have.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readOnlyFor, TOOL_SCOPES } from "../../shared/scope.mjs";
import { withAnnotations } from "../../mcp-server/server.mjs";
import { instructionsFor } from "../../mcp-server/lib/instructions.mjs";
import { CONNECT_CLIENTS } from "../../shared/connect-clients.mjs";
import { nonEmpty } from "../../shared/vacuous-pass.mjs";

test("tracker issue 148 — a read does not prompt and a write still does", () => {
  // THE ISSUE'S OWN ACCEPTANCE, in its own words: "brief and list_runs complete without an approval
  // prompt; start_run still asks. That is the test, not the presence of a field."
  for (const name of ["brief", "list_runs"]) {
    assert.equal(withAnnotations({ name }).annotations.readOnlyHint, true, `${name} still prompts`);
  }
  assert.equal(withAnnotations({ name: "start_run" }).annotations.readOnlyHint, false,
    "start_run stopped asking — it spends real money");
});

test("tracker issue 148 — the hint is derived from the scope table, not a second list", () => {
  // A second name for one fact desynchronises the moment one is edited, and this fact also decides who
  // may call the tool. Every tool's hint must be reproducible from the table alone.
  const names = Object.keys(TOOL_SCOPES);
  nonEmpty(names, "the scope table is empty, so this arm checked nothing");
  for (const name of names) {
    const rule = TOOL_SCOPES[name];
    const expected = typeof rule.readOnly === "boolean" ? rule.readOnly : !rule.write;
    assert.equal(readOnlyFor(name), expected, `${name}'s hint is not what the table says`);
  }
});

test("tracker issue 148 — what_if_plan is settled explicitly, and it is the only exception", () => {
  // The issue is explicit: settle it rather than letting the derivation decide silently. `write: true`
  // sits on it for the OPS ALLOWLIST's sake — the tool itself spends nothing — so deriving the hint
  // straight from `write` would prompt before a dry run.
  assert.equal(readOnlyFor("what_if_plan"), true, "a dry run that spends nothing is asking for permission");
  assert.equal(TOOL_SCOPES.what_if_plan.write, true, "the ops allowlist flag was cleared as a side effect");

  const exceptions = Object.entries(TOOL_SCOPES).filter(([, r]) => typeof r.readOnly === "boolean").map(([n]) => n);
  assert.deepEqual(exceptions, ["what_if_plan"],
    "a second readOnly override appeared — each one is a place the derivation stops being the truth, "
    + "so it needs its reason at the entry and a line here");
});

test("tracker issue 148 — an unknown tool is not claimed to be safe", () => {
  // Refusing to claim a tool is read-only is the right way to be wrong.
  assert.equal(readOnlyFor("a_tool_that_does_not_exist"), false);
});

test("tracker issue 148 — the ops briefing carries the document it tells the assistant to read", () => {
  const ops = instructionsFor({ kind: "ops" }) ?? "";
  nonEmpty([ops], "the ops pack is empty, so this arm proves nothing");
  // It refers to COURIER.md twice; both references must now resolve to text the assistant HAS.
  assert.match(ops, /Couriering the engine/, "the ops pack still does not carry the courier loop");
  assert.match(ops, /alreadySent/, "the pack names the delivery loop but not its idempotency guard");
});

test("tracker issue 148 — the courier loop does not leak into a client briefing", () => {
  // The control. Shipping an extra file to one audience must not widen any other.
  for (const kind of ["user", "account"]) {
    const pack = instructionsFor({ kind }) ?? "";
    assert.doesNotMatch(pack, /Couriering the engine/, `the ${kind} pack was handed the ops courier loop`);
  }
});

test("tracker issue 148 — no connector row names a control the dialog does not have", () => {
  // The cowork row said "Choose API key". There is no such control; the flow is a request header.
  // Asserted over EVERY row rather than the one that was wrong — the issue names the class as "the
  // connector table asserts vendor behaviour from no observation", and cowork was its second instance.
  nonEmpty(CONNECT_CLIENTS, "the connector table is empty");
  for (const row of CONNECT_CLIENTS) {
    const steps = (row.steps?.({ address: "https://example.test/mcp", command: null }) ?? []).join(" | ");
    assert.doesNotMatch(steps, /choose api key/i,
      `${row.id} tells a reader to choose an API key; that control does not exist in the dialog`);
  }
});
