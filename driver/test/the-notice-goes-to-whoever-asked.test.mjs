// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// The completion notice goes to whoever ASKED (tracker issue 289, part b).
//
// THE DEFECT. `whatsappTo` was `AGENT_WHATSAPP[agentId]` — a map keyed by AGENT ID. Every user of a
// deployment shares one agent, so on every run the operator was paged for work somebody else ordered and
// the person who ordered it was told nothing. Observed on a delivered run: started by one account, and
// the attestation reads "WhatsApp notification delivered to" the account owner.
//
// OWNER RULING, 2026-09-07: route to the requester where a number is held for them, and keep the
// operator's number as a copy the operator can switch off. Both halves, independently.
//
// ENV IS SET BEFORE THE FIRST IMPORT, deliberately. Both rosters are read once at module load — the same
// discipline the agent roster has always had — so a test that imported first and set the environment
// afterwards would measure the defaults and pass on any implementation.
import { test } from "node:test";
import assert from "node:assert/strict";

const REQUESTER = "+41000000111";
const OPERATOR = "+41000000999";

process.env.CLEAROTRON_AGENT_WHATSAPP = JSON.stringify({ clawdi: OPERATOR });
process.env.CLEAROTRON_REQUESTER_WHATSAPP = JSON.stringify({
  "lisa@tenant.example": REQUESTER,
  "jordan": "+41000000222",
});
delete process.env.CLEAROTRON_WHATSAPP_OPERATOR_COPY;

const { whatsappRouting } = await import("../stages.mjs");

const job = (over = {}) => ({ forwarder: "somebody", forwarderEmail: "lisa@tenant.example", ...over });

// ── the requester is the recipient ───────────────────────────────────────────────────────────────────

test("289b: the notice is addressed to the requester, not to whoever runs the agent", () => {
  const r = whatsappRouting(job(), "clawdi");
  assert.equal(r.whatsappTo, REQUESTER, "the person who asked");
  assert.notEqual(r.whatsappTo, OPERATOR, "and specifically NOT the operator, which is what shipped");
  assert.equal(r.whatsappToReason, null, "no reason is stated when there is a recipient");
});

test("289b: the requester resolves by email, and by handle when no email is held", () => {
  assert.equal(whatsappRouting(job(), "clawdi").whatsappTo, REQUESTER, "email wins where both could match");
  assert.equal(whatsappRouting(job({ forwarderEmail: null, forwarder: "jordan" }), "clawdi").whatsappTo,
    "+41000000222", "a job with only a handle still reaches its requester");
  assert.equal(whatsappRouting(job({ forwarderEmail: "LISA@TENANT.EXAMPLE" }), "clawdi").whatsappTo, REQUESTER,
    "an address is matched case-insensitively — a roster is typed by a person");
});

// ── acceptance 6: absence is STATED, never filled in ─────────────────────────────────────────────────
//
// This is the arm that matters most. Silently falling back to the operator is precisely the behaviour
// being replaced, and it is invisible: the notice arrives, somebody reads it, and nothing anywhere says
// it went to the wrong person.
test("289b: with no number held, the packet SAYS SO and does not quietly use the operator", () => {
  const r = whatsappRouting(job({ forwarderEmail: "nobody@tenant.example", forwarder: "nobody" }), "clawdi");
  assert.equal(r.whatsappTo, null, "no recipient is invented");
  assert.notEqual(r.whatsappTo, OPERATOR, "and the operator is NOT substituted in — the old behaviour");
  assert.match(r.whatsappToReason, /no chat number is held/, "the gap is stated");
  assert.match(r.whatsappToReason, /nobody@tenant\.example/, "and it names who could not be reached");
});

// ── acceptance 5: the operator's copy is separate and switchable ─────────────────────────────────────

test("289b: the operator keeps a copy, and it is a DIFFERENT field from the requester's", () => {
  const r = whatsappRouting(job(), "clawdi");
  assert.equal(r.whatsappCcOperator, OPERATOR, "the operator still gets their copy by default");
  assert.equal(r.whatsappTo, REQUESTER);
  assert.notEqual(r.whatsappCcOperator, r.whatsappTo, "two recipients, two fields — not one field fought over");
});

test("289b: the operator can drop their copy WITHOUT dropping the requester's notice", async () => {
  process.env.CLEAROTRON_WHATSAPP_OPERATOR_COPY = "0";
  const fresh = await import(`../stages.mjs?operator-copy-off=${Date.now()}`);
  const r = fresh.whatsappRouting(job(), "clawdi");
  assert.equal(r.whatsappCcOperator, null, "the operator is out of everyone else's runs");
  assert.equal(r.whatsappTo, REQUESTER, "and the person who asked is still told — the half that must survive");
  delete process.env.CLEAROTRON_WHATSAPP_OPERATOR_COPY;
});

// A deployment that configured nothing must not route a client's notice at an invented number. The agent
// roster carries a demo fallback for offline tests; doing the same for REQUESTERS would mean a real
// completion notice addressed to a fixture.
test("289b: an unconfigured requester roster is EMPTY, never a demo one", async () => {
  const saved = process.env.CLEAROTRON_REQUESTER_WHATSAPP;
  delete process.env.CLEAROTRON_REQUESTER_WHATSAPP;
  const fresh = await import(`../stages.mjs?no-roster=${Date.now()}`);
  assert.deepEqual(fresh.REQUESTER_WHATSAPP, {}, "no invented numbers");
  const r = fresh.whatsappRouting(job(), "clawdi");
  assert.equal(r.whatsappTo, null);
  assert.match(r.whatsappToReason, /no chat number is held/, "and it says why rather than going quiet");
  process.env.CLEAROTRON_REQUESTER_WHATSAPP = saved;
});
