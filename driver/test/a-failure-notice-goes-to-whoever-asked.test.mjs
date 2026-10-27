// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// A FAILURE NOTICE GOES TO WHOEVER ASKED, AS THE COMPLETION NOTICE DOES.
//
// The completion notice was moved off the agent's number (the-notice-goes-to-whoever-asked.test.mjs): every user of a
// deployment shares one agent, so the agent's number is the operator's. The failure notices stayed on it, so a run that
// failed told the operator and not the person who asked for it. Measured on 2026-10-27: a lawyer's assistant started a
// run in chat, it failed, and its notice named the owner's number while naming the lawyer's address.
//
// Every notice now takes its chat route from `whatsappRouting`: the requester's number where one is held, the gap stated
// where none is, and the operator's copy beside it. ENV IS SET BEFORE THE FIRST IMPORT: both rosters are read once at
// module load.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const REQUESTER = "+41000000111";
const OPERATOR = "+41000000999";
process.env.CLEAROTRON_AGENT_WHATSAPP = JSON.stringify({ mailagent: OPERATOR });
process.env.CLEAROTRON_REQUESTER_WHATSAPP = JSON.stringify({ "robin@tenant.example": REQUESTER });
delete process.env.CLEAROTRON_WHATSAPP_OPERATOR_COPY;

const { buildFailurePacket } = await import("../pipeline.mjs");
const HERE = dirname(fileURLToPath(import.meta.url));

const failure = (job) => buildFailurePacket({ runId: "velmorax-2026-10-27-amber-finch", agent: "mailagent", job,
  failedStage: "register-unit:primary-sweep", shortReason: "the register timed out", reasonVerbatim: "timed out",
  sig: "s", failClass: "transient", terminalKind: "exhausted" });

test("a failure notice is addressed to the requester, with the operator's copy beside it", () => {
  const p = failure({ markName: "VELMORAX", forwarder: "robin", forwarderEmail: "robin@tenant.example" });
  assert.equal(p.whatsappTo, REQUESTER, "the person who asked");
  assert.notEqual(p.whatsappTo, OPERATOR, "and not the operator, which every failure notice named");
  assert.equal(p.whatsappCcOperator, OPERATOR, "the operator keeps the page, as a copy");
  assert.equal(p.whatsappChannel, "whatsapp", "the route names its channel, as the completion notice's does");
  assert.equal(p.whatsappToReason, null);
});

test("with no number held for the requester, the failure notice says so and does not fall back to the operator", () => {
  const p = failure({ markName: "VELMORAX", forwarder: "ellis", forwarderEmail: "ellis@tenant.example" });
  assert.equal(p.whatsappTo, null, "no recipient is invented");
  assert.match(p.whatsappToReason, /no chat number is held for ellis@tenant\.example/, "the gap is stated, naming who");
  assert.equal(p.whatsappCcOperator, OPERATOR);
});

test("no notice anywhere takes its chat recipient from the agent's number", () => {
  // The floor behind the two arms above: the pre-run and late-bind notices are built inline, so they are held by their
  // source. A packet key `whatsappTo:` read off the agent roster is the defect, wherever it reappears.
  for (const f of ["pipeline.mjs", "pipeline-knockout.mjs", "runner.mjs"]) {
    const src = readFileSync(join(HERE, "..", f), "utf8").split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n");
    assert.doesNotMatch(src, /whatsappTo:\s*AGENT_WHATSAPP\[/, `${f} addresses a notice to the agent's number`);
    assert.match(src, /whatsappRouting\(/, `${f} routes no notice through whatsappRouting — the floor is reading nothing`);
  }
});
