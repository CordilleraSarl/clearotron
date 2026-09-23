// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// THE LISTING IS THE WALL. Over the network an ops token is not shown what_if_plan or what_if_run, and
// the call handler used to run them anyway when one was called by name, because only the listing was
// filtered and authorize() lets an ops token through. what_if_run starts the engine, so a hidden tool
// that runs is a spend path nobody sees offered.
//
// Each arm replaces the tool with a recorder, so what it proves is whether the tool RAN, not which
// sentence came back. The controls are the same call on the doors where the listing shows the tool.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pinEnv } from "../../shared/env-aliases.mjs";
pinEnv(process.env, "CLEAROTRON_WORK_DIR", mkdtempSync(join(tmpdir(), "listing-wall-")));
import { test } from "node:test";
import assert from "node:assert/strict";

const { tools, attachHandlers } = await import("../server.mjs");
const { CallToolRequestSchema, ListToolsRequestSchema } = await import("@modelcontextprotocol/sdk/types.js");

function door(scope, local) {
  const h = new Map();
  attachHandlers({ setRequestHandler(schema, fn) { h.set(schema, fn); } }, { scope, local });
  return {
    listed: async () => (await h.get(ListToolsRequestSchema)({ params: {} })).tools.map((t) => t.name),
    call: (name, args = {}) => h.get(CallToolRequestSchema)({ params: { name, arguments: args } }),
  };
}

/** Swap `name` for a recorder for the length of `fn`; returns what fn returned and how often the tool ran. */
async function recording(name, fn) {
  const real = tools[name];
  let ran = 0;
  tools[name] = async () => { ran += 1; return { recorded: name }; };
  try { return { result: await fn(), ran: () => ran }; } finally { tools[name] = real; }
}

const OPS = { kind: "ops", runId: null, sub: "wall-arm", verbs: null, accounts: "*" };

for (const name of ["what_if_plan", "what_if_run"]) {
  test(`${name}: an ops token over the network is not shown it, and calling it by name does not run it`, async () => {
    const http = door(OPS, false);
    assert.ok(!(await http.listed()).includes(name), `${name} is listed to an ops token over the network; this arm measures nothing`);
    const { result, ran } = await recording(name, () => http.call(name, { runId: "r1" }));
    assert.equal(ran(), 0, `${name} RAN for an ops token over the network, where the listing hides it`);
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, new RegExp(`unknown tool "${name}"`), "the refusal is not the one a name that does not exist gets");
  });

  test(`${name}: the same token on the local door is shown it and it runs (the control)`, async () => {
    const local = door(OPS, true);
    assert.ok((await local.listed()).includes(name), `${name} is not listed on the local door`);
    const { ran } = await recording(name, () => local.call(name, { runId: "r1" }));
    assert.equal(ran(), 1, `${name} did not run on the local door, so the arm above would pass on a tool that never runs anywhere`);
  });
}

test("a client account over the network is shown what_if_plan and it runs, as listed", async () => {
  // Listed for an account on purpose (accountSafe): the wall follows the listing, it does not narrow it.
  const account = door({ kind: "account", runId: null, sub: "client@example.com", verbs: null, accounts: "*",
    permissions: { run: true, manage: false } }, false);
  assert.ok((await account.listed()).includes("what_if_plan"), "what_if_plan is no longer listed to an account");
  const { ran } = await recording("what_if_plan", () => account.call("what_if_plan", { runId: "r1", stage: "report-overview" }));
  assert.equal(ran(), 1, "the wall refused a tool the listing shows");
});

test("a caller authorize() already refuses keeps the refusal it names", async () => {
  // Staff (internal) are shown no write tool and authorize() refuses them one, with its own sentence. The
  // wall comes after authorize(), so that sentence still reaches them rather than "unknown tool".
  const staff = door({ kind: "internal", runId: null, sub: null, verbs: null, accounts: "*" }, false);
  const { result, ran } = await recording("start_run", () => staff.call("start_run", {}));
  assert.equal(ran(), 0);
  assert.match(result.content[0].text, /^FORBIDDEN \(start_run\)/, "the refusal authorize() names was replaced");
});
