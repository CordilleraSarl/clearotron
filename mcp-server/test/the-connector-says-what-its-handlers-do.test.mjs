// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// THE CONNECTOR TELLS A CLIENT'S ASSISTANT WHAT ITS HANDLERS ACTUALLY DO (design, 2026-11-24).
//
// Each arm below is a promise that disagreed with the code behind it: an argument required and then stamped by the gate,
// an argument offered and then refused by name, a settle call the outbox does not settle with, a field the handler
// refuses, a capability claimed for searches that never run it, and tool names a report link does not hold. The gate is
// not changed by any of this; only what the assistant is told.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { pinEnv } from "../../shared/env-aliases.mjs";

const WORK = mkdtempSync(join(tmpdir(), "connector-handlers-"));
after(() => rmSync(WORK, { recursive: true, force: true }));
pinEnv(process.env, "CLEAROTRON_WORK_DIR", WORK);
pinEnv(process.env, "CLEAROTRON_DEFAULT_AGENT", "intake-agent");
pinEnv(process.env, "CLEAROTRON_REPORTS_DIR", join(WORK, "pool"));

const { TOOL_DEFS, describeForAudience, BRIEFING_NOTE } = await import("../server.mjs");
const { feedContext } = await import("../lib/ops.mjs");
const { visibleTools } = await import("../../shared/scope.mjs");
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const pack = (d, f = "SKILL.md") => readFileSync(join(ROOT, "skills", d, f), "utf8").split("\n").join(" ").replace(/ +/g, " ");
const def = (name) => TOOL_DEFS.find((d) => d.name === name);
const as = (name, kind) => describeForAudience(def(name), kind);

test("a client's session is not asked for the forwarder its gate stamps, and an operator still is", () => {
  for (const name of ["plan_run", "start_run"]) {
    assert.ok(!(as(name, "account").inputSchema.required ?? []).includes("forwarder"),
      `${name}: an account's assistant is told to supply a forwarder the gate stamps from its identity, so it invents one`);
    assert.ok("forwarder" in as(name, "account").inputSchema.properties, `${name}: the field a client may still choose is gone`);
  }
  assert.ok(as("start_run", "ops").inputSchema.required.includes("forwarder"), "an operator's start_run has no stamp, and still needs it");
});

test("a client's session is not offered the model its gate refuses", () => {
  const plan = as("what_if_plan", "account");
  assert.equal("model" in plan.inputSchema.properties, false, "the account is offered a model and then refused for sending it");
  assert.doesNotMatch(plan.description, /model(?! tokens)/, "the description still invites a model");
  assert.ok("model" in as("what_if_plan", "ops").inputSchema.properties, "the operator's tool lost a field it may use");
});

test("a report link is told only of the tools it holds, and that a group is required", () => {
  const held = visibleTools({ kind: "user", local: false, demo: false });
  // Tool names an English sentence cannot use by accident: the ones with an underscore, and trace.
  const named = (text) => TOOL_DEFS.map((d) => d.name).filter((n) => (n.includes("_") || n === "trace") && new RegExp(`\\b${n}\\b`).test(text));
  for (const name of ["brief", "list_findings"]) {
    const text = as(name, "user").description;
    assert.deepEqual(named(text).filter((n) => !held(n)), [], `${name} points a report link at tools it does not hold`);
  }
  assert.match(as("list_findings", "user").description, /Pass group: on-field, off-field or out-of-scope; on this connection it is required\./);
  assert.equal(as("list_findings", "account").description, def("list_findings").description, "the account keeps the raw view's description");
  assert.match(pack("clearotron-client"), /## Your tools/, "the report link's briefing still counts its tools");
});

test("a run-failed notice is settled with mark_sent, as the courier's instructions and the outbox both say", () => {
  assert.match(def("list_outbox_events").description, /settle delivered and run-failed events with mark_sent, and every other kind with ack_event/);
  assert.match(def("ack_event").description, /Delivered and run-failed events are settled by mark_sent instead\./);
  assert.match(pack("clearotron-ops", "COURIER.md"), /`kind: "run-failed"`.*\*\*`mark_sent \{ runId, messageId \}`\*\*, not `ack_event`/);
});

test("feed_context is described as taking what its handler takes", () => {
  assert.throws(() => feedContext({ runId: "quillmere-run", instructions: "search the EU only" }), /instructions is not accepted/);
  assert.doesNotMatch(pack("clearotron-ops"), /feed_context`, whose field is `instructions`/, "the ops briefing still sends guidance through a refused field");
  assert.doesNotMatch(pack("clearotron-ops"), /A changed instruction while a run is in flight goes in through `feed_context`/);
  assert.match(pack("clearotron-ops"), /`feed_context` takes only the applicant and exclusions; it carries no instructions\./);
});

test("the native-language reading is claimed only for the searches that run it, and no model or step is named", () => {
  for (const d of ["clearotron-client", "clearotron-account"]) {
    assert.doesNotMatch(pack(d), /where the territories call for (it|them)/, `${d} claims a native-language reading on searches that never run one`);
    assert.match(pack(d), /on a full country search, (or|and on) a multi-country focus search that added (it|them)/);
  }
  assert.equal(BRIEFING_NOTE.endsWith("Name no model, internal step, tool or document in the answer."), true,
    "the note riding every plain-language answer still licenses what both briefings forbid");
  for (const kind of ["user", "account"])
    assert.doesNotMatch(as("start_run", kind).description, /takes hours/, "the client's start_run still promises hours instead of the preview's turnaround");
  assert.doesNotMatch(def("describe_options").description, /once the requester has confirmed/,
    "the shared tool text still sets a confirmation policy that contradicts the operator's briefing");
});
