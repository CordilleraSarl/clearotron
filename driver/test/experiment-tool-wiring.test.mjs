// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// — AN EXPERIMENT ARM MUST HOLD THE SAME TOOLS AS THE PRODUCTION STAGE IT MEASURES.
//
// The issue was filed on this reading: four `--experiment common-law-half` arms failed byte-identically
// with `grid_ledger_missing: common-law-grid.half-m.json absent while _driver/grid-spec.half-m.json
// dictates the meaning sweep`, in 67–70s, having attempted no sweep — so "the arm's dispatch apparently
// carries no perplexity server/toolgroup".
//
// ── THAT READING IS WRONG, AND THESE TESTS ARE WHY IT STAYS WRONG ────────────────────────────────
//
// There is exactly ONE label construction in the dispatch path (pipeline.mjs stageOnce:
// `name + (ctx.axis ? ":" + ctx.axis : "")`), and `runExperiment` reaches it the same way production
// does — stage() → stageWithChain() → stageOnce(). So the arm resolves `["perplexity"]` and gets a
// `perplexity` MCP server, exactly as the production dispatch does. The tests below drive both sides
// through the real functions rather than asserting a belief about them.
//
// ── WHAT THE REAL DEFECT IS ──────────────────────────────────────────────────────────────────────
//
// At least four different causes present to the driver as one sentence — "the ledger is absent":
//   · the seat held no research tool                (ruled out below, for every stage)
//   · PERPLEXITY_API_KEY unset — the server starts fine and answers the CALL with an ERROR string
//     (perplexity-server.mjs:108), which the driver never sees
//   · the tool refused the output_path             (perplexity-server.mjs:116, the studio/prelim-search guard)
//   · the seat simply did not call it
//
// The arm's context receipt now records its wiring, so the first of those is answerable from the record
// instead of by argument. Distinguishing the other three means changing what the validator reports,
// which is a behaviour change on the engine path and is not done here.

import { test } from "node:test";
import { pinEnv, envFrom } from "../../shared/env-aliases.mjs";   // — a fixture pins EVERY spelling; the default is taken only when NO spelling holds one
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// The register group resolves the ACTIVE provider and throws when none is set, which is a real
// environment fact this file must not depend on — set one before importing anything that reads it.
pinEnv(process.env, "CLEAROTRON_DATABASE", envFrom(process.env, "CLEAROTRON_DATABASE") ?? "euipo");

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");

const { dispatchLabel, experimentWiring } = await import("../pipeline.mjs");
const { STAGES } = await import("../stages.mjs");
const { toolGroupsForStage, TOOL_FREE_STAGES, buildGatherMcpConfig, allowedToolsFor } =
  await import("../engine/mcp/gather-config.mjs");

// The axes each axis-taking stage is dispatched under, production and sandbox alike.
const AXIS_CASES = [
  ["common-law-half", "m"], ["common-law-half", "b"],
  ["register-unit", "primary-sweep"],
  ["report-card", "1"],
];

const wiringVia = (label, opts) => {
  const groups = toolGroupsForStage(label);
  const cfg = groups.length ? buildGatherMcpConfig(groups, opts) : null;
  return { groups, servers: cfg ? Object.keys(cfg.mcpServers).sort() : [], allowedTools: groups.length ? (allowedToolsFor(groups) || null) : null };
};

// ══ the label is ONE construction, shared ═══════════════════════════════════════════════════════

test("#700 the sandbox dispatches on the same label production does — one construction site", () => {
  const src = readFileSync(join(ROOT, "driver", "pipeline.mjs"), "utf8");
  const sites = [...src.matchAll(/const label = name \+ \(ctx\.axis \? `:\$\{ctx\.axis\}` : ""\);/g)];
  assert.ok(sites.length >= 1, "stageOnce still builds the dispatch label from name + ctx.axis");
  // `dispatchLabel` must reproduce it exactly, because the receipt claims to describe the dispatch.
  for (const [name, axis] of AXIS_CASES) {
    assert.equal(dispatchLabel(name, axis), `${name}:${axis}`);
  }
  assert.equal(dispatchLabel("synthesis", null), "synthesis");
  assert.equal(dispatchLabel("synthesis", undefined), "synthesis");
  // runExperiment reaches stageOnce through stage(); there is no second dispatch path to diverge.
  assert.match(src, /const r = await stage\(name, shadowCtx, \{ force: true, model, extra, sessionKey, trigger: "experiment" \}\)/,
    "the arm dispatches through stage() — if it ever grows its own runStage call, the wiring can diverge and this test is the warning");
});

// ══ every stage: arm wiring == production wiring ═════════════════════════════════════════════════

test("#700 for EVERY stage, an arm's tool wiring equals the production dispatch's", () => {
  const opts = { sessionKey: "prelim-x-y-z", agent: "prelim-agent-1", runDir: "/srv/x/studio/prelim-search/j/c" };
  const armOpts = { ...opts, sessionKey: "prelim-exp-x-y-z", runDir: `${opts.runDir}/_experiments/2026-01-01-x` };
  let tooled = 0;
  for (const name of Object.keys(STAGES)) {
    const axes = AXIS_CASES.filter(([n]) => n === name).map(([, a]) => a);
    for (const axis of axes.length ? axes : [null]) {
      const label = dispatchLabel(name, axis);
      const prod = wiringVia(label, opts);
      const arm = experimentWiring(name, axis, armOpts);
      assert.equal(arm.refusal, null, `${label}: the arm's wiring could not be built — ${arm.refusal}`);
      assert.deepEqual(arm.groups, prod.groups, `${label}: tool GROUPS differ between the arm and production`);
      assert.deepEqual(arm.servers, prod.servers, `${label}: MCP SERVERS differ between the arm and production`);
      assert.equal(arm.allowedTools, prod.allowedTools, `${label}: allowedTools differ between the arm and production`);
      if (prod.groups.length) tooled++;
    }
  }
  assert.ok(tooled >= 5, `only ${tooled} tooled dispatch(es) were compared — the sweep has gone hollow`);
});

// ══ the one this issue is about, named ══════════════════════════════════════════════════════════

test("#700 a common-law-half arm DOES hold the research tool — the issue's premise, tested", () => {
  const arm = experimentWiring("common-law-half", "m",
    { sessionKey: "prelim-exp-a", agent: "prelim-agent-1", runDir: "/srv/x/studio/prelim-search/j/c/_experiments/e" });
  // — TWO groups and two servers. The disposition transport left the shared `perplexity` entry
  // for its own key; an experiment arm resolves the SAME map as the production dispatch, so it picks up
  // the split without a second declaration — which is the property the sweep above exists to keep.
  assert.deepEqual(arm.groups, ["perplexity", "dispositions"]);
  assert.deepEqual(arm.servers, ["dispositions", "perplexity"]);   // `servers` is sorted by experimentWiring; `groups` keeps the map's order
  assert.match(arm.allowedTools, /perplexity_research/,
    "the tool the meaning sweep is ordered to call is in the arm's allowlist");
  // …and the lane's OWN record tool rides with it, under the server key it now has. An experiment arm
  // that could search but not record its rulings would be a half-wired copy of the production seat.
  assert.match(arm.allowedTools, /mcp__dispositions__record_dispositions/,
    "the arm cannot record what its sweep decides — the disposition transport did not follow the split");
  assert.equal(arm.label, "common-law-half:m");
  // Both halves, because a per-half wiring difference would be exactly the kind of thing that reads as
  // "the arm has no tools" on one axis and works on the other.
  assert.deepEqual(experimentWiring("common-law-half", "b", {}).groups, ["perplexity", "dispositions"]);
});

test("#700 the tool this sweep needs is reachable, but its ABSENCE would not be visible to the driver", () => {
  // The gap that remains after the wiring is ruled out. Stated as an assertion over the server's own
  // source because it is the reason a fix here would have been aimed at the wrong thing.
  const src = readFileSync(join(ROOT, "driver", "engine", "mcp", "perplexity-server.mjs"), "utf8");
  assert.match(src, /if \(!API_KEY\) return "ERROR: PERPLEXITY_API_KEY not set/,
    "a keyless server STARTS and refuses at the call — so the tool is present, answers an error string, "
    + "and the driver's record shows only that no ledger appeared");
  assert.match(src, /grid spec\.output_path must be within a studio\/prelim-search run dir/,
    "…and a path the tool refuses produces the same silence");
});

// ══ tool-free stages stay tool-free in the sandbox too ══════════════════════════════════════════

test("#700 a tool-free stage gets no servers in an arm either — an arm is not a wider grant", () => {
  for (const name of Object.keys(TOOL_FREE_STAGES)) {
    const axis = name === "report-card" ? "1" : null;
    const arm = experimentWiring(name, axis, { sessionKey: "k", agent: "a", runDir: "/r" });
    assert.deepEqual(arm.groups, [], `${name} is declared tool-free (${TOOL_FREE_STAGES[name]})`);
    assert.deepEqual(arm.servers, []);
    assert.equal(arm.allowedTools, null);
    assert.equal(arm.refusal, null, "and a declared absence is not a refusal");
  }
});

// ══ the receipt must not become a credential store ══════════════════════════════════════════════

test("#700 the wiring record carries NAMES, never the servers' env", () => {
  const arm = experimentWiring("synthesis", null, { sessionKey: "k", agent: "a", runDir: "/r" });
  // — synthesis gained the `declination` server (record_declination). Still NAMES only, which is
  // what this test is about: the new entry carries an env block like every other, and the assertion
  // below is what proves none of it reached the artifact.
  // — and again with `recording-synthesis` (record_synthesis) at the writer's
  // typed-transport conversion. Same reasoning, and checked rather than assumed: the recording servers
  // are LOCAL, so serverEnv hands them CLEAROTRON_GATHER_SESSION_KEY, CLEAROTRON_BAND_RUN_DIR and
  // CLEAROTRON_REGISTER_CALL_LOG — all three of the names the regex below greps for. A member whose env
  // could not have leaked would have widened this list without widening the guard.
  assert.deepEqual(arm.servers, ["band", "declination", "perplexity", "recording-synthesis"]);
  const json = JSON.stringify(arm);
  assert.ok(!/CLEAROTRON_GATHER_SESSION_KEY|CLEAROTRON_BAND_RUN_DIR|CLEAROTRON_REGISTER_CALL_LOG/.test(json),
    "the MCP server entries carry an env block; copying it into a run artifact is how a receipt "
    + "quietly becomes a place credentials live");
  assert.ok(!/command|args/.test(json), "…and the node path and argv are not context either");
});

test("#700 a wiring that cannot be built is recorded as a REFUSAL, never as an empty grant", () => {
  // The register group resolves the active provider and throws when none is configured. An arm run in
  // that environment held no register tools — but so does a stage that legitimately has none, and
  // {groups: []} for both is the absence-read-as-pass this repo keeps paying for.
  const saved = process.env.CLEAROTRON_DATABASE;
  pinEnv(process.env, "CLEAROTRON_DATABASE", undefined);
  try {
    const arm = experimentWiring("register-unit", "primary-sweep", { sessionKey: "k", agent: "a", runDir: "/r" });
    // Either the provider const was frozen at import (so it still resolves) or it throws — both are
    // honest, and neither may report an empty toolset.
    // — `unit-note` joins, and it is the half of this arm that CAN still resolve:
    // the register group throws without a provider, this one never touches one. Both are named so a
    // refusal that silently dropped the transport too would not read as the honest partial it is not.
    assert.deepEqual(arm.groups, ["register", "unit-note"], "the GROUPS are known from the label regardless");
    if (arm.refusal !== null) {
      assert.equal(arm.servers, null, "a refusal reports null servers, not zero servers");
      assert.match(arm.refusal, /buildGatherMcpConfig threw/);
    } else {
      assert.ok(Array.isArray(arm.servers) && arm.servers.length >= 1);
    }
  } finally { pinEnv(process.env, "CLEAROTRON_DATABASE", saved); }
});
