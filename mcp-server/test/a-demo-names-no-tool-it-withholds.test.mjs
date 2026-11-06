// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A DEMO'S ASSISTANT IS NOT SENT TO A TOOL THE DEMO WITHHOLDS. A demo withholds start_run, and plan_run's description, as the
// operator's assistant and as a signed-in client's assistant read it, and describe_options' closing note still said to call it.
// In a demo they take the owner's words (2026-11-06), and the guidance opens with the demo's own line. A real install keeps its
// words: each arm has that control.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pinEnv } from "../../shared/env-aliases.mjs";

const ROOT = mkdtempSync(join(tmpdir(), "demo-texts-"));
after(() => rmSync(ROOT, { recursive: true, force: true }));
pinEnv(process.env, "CLEAROTRON_WORK_DIR", ROOT);
pinEnv(process.env, "CLEAROTRON_DEFAULT_AGENT", "intake-agent");
pinEnv(process.env, "CLEAROTRON_REPORTS_DIR", join(ROOT, "pool"));

const { TOOL_DEFS, describeForAudience, attachHandlers } = await import("../server.mjs");
const { describeOptions } = await import("../lib/options.mjs");
const { instructionsFor } = await import("../lib/instructions.mjs");
const { DEMO_SWAPS, DEMO_GUIDANCE_LINE, demoGuidance } = await import("../lib/demo-texts.mjs");
const { demoMode } = await import("../demo-mode.mjs");
const { ListToolsRequestSchema } = await import("@modelcontextprotocol/sdk/types.js");

const OPS = { kind: "ops", runId: null, sub: "demo-texts-arm", verbs: null, accounts: "*" };
const ACCOUNT = { kind: "account", runId: null, sub: "client@example-firm.test", accounts: ["demo-brand-owner"] };
const listed = async (scope) => {
  const h = new Map();
  attachHandlers({ setRequestHandler(schema, fn) { h.set(schema, fn); } }, { scope, local: true });
  return (await h.get(ListToolsRequestSchema)({ params: {} })).tools;
};
const inDemoMode = async (fn) => { demoMode.on = true; try { return await fn(); } finally { demoMode.on = false; } };
const plan = TOOL_DEFS.find((d) => d.name === "plan_run");

test("every word a demo replaces is still there to replace, so a drifted text is refused rather than passed through", () => {
  for (const [from] of DEMO_SWAPS["plan_run:ops"]) assert.ok(plan.description.includes(from), `plan_run's description no longer says: ${from}`);
  for (const [from] of DEMO_SWAPS["plan_run:client"])
    assert.ok(describeForAudience(plan, "account").description.includes(from), `plan_run's client description no longer says: ${from}`);
  for (const [from] of DEMO_SWAPS["describe_options:note"])
    assert.ok(describeOptions({}, { scope: OPS })._note.includes(from), `describe_options' note no longer says: ${from}`);
});

test("in a demo, plan_run's description, for the operator's and the client's assistant, names no start tool", async () => {
  for (const scope of [OPS, ACCOUNT]) {
    const demo = (await inDemoMode(() => listed(scope))).find((t) => t.name === "plan_run");
    assert.ok(demo, `${scope.kind}: plan_run is not offered in a demo`);
    assert.doesNotMatch(demo.description, /start_run/, `${scope.kind}: a demo's plan_run names a tool the demo withholds`);
    assert.match(demo.description, /A demo cannot start it\./, `${scope.kind}: the demo's words are missing`);
    // CONTROL: a real install's plan_run still hands the confirmed request on.
    const real = (await listed(scope)).find((t) => t.name === "plan_run");
    assert.match(real.description, /start_run/, `${scope.kind}: a real install lost its words`);
  }
});

test("in a demo, describe_options' note names no start tool; a real install keeps it", async () => {
  const demo = await inDemoMode(() => describeOptions({}, { scope: OPS }));
  assert.doesNotMatch(demo._note, /start_run/, "a demo's note names a tool the demo withholds");
  assert.match(demo._note, /Show that to the requester\. A demo cannot start it\.$/);
  assert.match(describeOptions({}, { scope: OPS })._note, /only then call start_run with the SAME arguments\.$/, "a real install lost its words");
});

test("a demo's guidance opens with the demo's line; a real install's is the pack alone", async () => {
  const pack = instructionsFor({ kind: "ops" });
  assert.ok(pack, "premise: the ops pack exists");
  assert.equal(demoGuidance(pack), `${DEMO_GUIDANCE_LINE}\n\n${pack}`);
  assert.equal(DEMO_GUIDANCE_LINE, "This is a demo: it answers from finished reports, and cannot start a search or a what-if.");
  assert.equal(demoGuidance(undefined), undefined, "an audience with no pack is given a line with nothing under it");
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../server.mjs", import.meta.url), "utf8");
  assert.match(src, /instructions: demoServing\(\) \? demoGuidance\(instructionsFor\(eff\)\) : instructionsFor\(eff\)/,
    "the server no longer gives a demo's assistant the demo line");
});
