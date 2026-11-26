// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A KNOCKOUT SWEEPS THROUGH THE RUN'S OWN SEARCH where its searches are its own (pipeline-knockout.mjs,
// resolveSweepExecutor; engine/mcp/own-search.mjs, ownSearchKnockoutGrid).
//
// Each name's dictated searches run in research-only sessions, made once for the run, and the ledger passes the grid's
// own capture. Its owner lookups are questions, which own search does not run yet: they go to Perplexity where its key
// is set, and are otherwise recorded as not run. A route with no web search of its own skips the web half under its own
// cause; until that cause has its approved sentence, the screen stops before anything is spent rather than run silent.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pinEnv } from "../../shared/env-aliases.mjs";
import { ownSearchKnockoutGrid, savedSearchRecords } from "../engine/mcp/own-search.mjs";
import { resolveSweepExecutor } from "../pipeline-knockout.mjs";
import { runOwnerChecks } from "../owner-use-check.mjs";
import { CAPABILITY_SKIPPED_CAUSE, CAPABILITY_SKIPPED_NOTE } from "../search-policy.mjs";

const codexSearch = (queries, results) => ({ type: "item.completed",
  item: { type: "web_search", action: queries.length > 1 ? { queries } : { query: queries[0] }, ...(results === undefined ? {} : { results }) } });
const aRun = (research, engine = "openai-agent") => {
  const d = mkdtempSync(join(tmpdir(), "own-search-knockout-"));
  mkdirSync(join(d, "_driver"), { recursive: true });
  if (research) writeFileSync(join(d, "_driver", "run-choices.json"), JSON.stringify({ schema: 1, engine, register: null, research }));
  return d;
};
const SPEC = (out) => ({ terms: ["QZORVAK"], platforms: ["web", "etsy.com"], use: "candles", results_per_cell: 2, output_path: out });

test("one name's searches run through the run's own program, sessions made once, the ledger passing the grid's capture", async () => {
  const runDir = aRun("own");
  try {
    let made = 0;
    const makeSessions = async () => { made++; return { search: "codex", engine: "openai-agent", session: async (batch) => ({ answered: true, seconds: 1, usage: null, model: "gpt-6-luna", speed: "standard",
      events: batch.map((d) => codexSearch([d.site ? `${d.query} site:${d.site}` : d.query], [{ title: "a", url: d.site ? `https://${d.site}/listing/1` : "https://example.test/1" }, { title: "b", url: d.site ? `https://${d.site}/listing/2` : "https://example.test/2" }, { title: "c", url: d.site ? `https://${d.site}/listing/3` : "https://example.test/3" }])) }) }; };
    const grid = ownSearchKnockoutGrid(runDir, { makeSessions });
    const r = await grid(SPEC(join(runDir, "research", "qzorvak.json")));
    assert.equal(r.ok, true, r.cause);
    assert.equal(r.requested, 2);
    assert.equal(r.present, 2);
    const ledger = JSON.parse(r.ledgerJson);
    assert.ok(ledger.cells.every((c) => c.candidates.length <= 2), "the spec's own result limit");
    await grid(SPEC(join(runDir, "research", "qzorvak-2.json")));
    assert.equal(made, 1, "the sessions are made once for the run");
    assert.ok(savedSearchRecords(runDir).length >= 2, "each search's record is kept with the run");
  } finally { rmSync(runDir, { recursive: true, force: true }); }
});

test("with no session, a name is not searched anywhere and says why; the cause is never one the lane retries as a program fault", async () => {
  const runDir = aRun("own");
  try {
    const r = await ownSearchKnockoutGrid(runDir, { makeSessions: async () => ({ error: "the engine is signed out" }) })(SPEC(join(runDir, "x.json")));
    assert.equal(r.ok, false);
    assert.match(r.cause, /^own search: the engine is signed out/);
    assert.doesNotMatch(r.cause, /^grid: /);
  } finally { rmSync(runDir, { recursive: true, force: true }); }
});

test("the lane takes its own search's sweep on a run whose searches are its own, and Perplexity's otherwise", () => {
  const saved = process.env.PERPLEXITY_API_KEY;
  try {
    pinEnv(process.env, "PERPLEXITY_API_KEY", undefined);
    const own = aRun("own");
    const keyless = resolveSweepExecutor({}, { runDir: own });
    assert.equal(keyless.source, "own:codex");
    assert.equal(typeof keyless.grid, "function");
    assert.equal(keyless.skipped, undefined, "own search needs no key for the sweep");
    assert.equal(keyless.ownerChecksBy, null, "with no key the owner lookups are not run");
    pinEnv(process.env, "PERPLEXITY_API_KEY", "test-offline");
    assert.equal(resolveSweepExecutor({}, { runDir: own }).ownerChecksBy, "perplexity", "with a key they go to Perplexity, as questions still do");
    const other = aRun("perplexity");
    assert.equal(resolveSweepExecutor({}, { runDir: other }).source, "perplexity");
    pinEnv(process.env, "PERPLEXITY_API_KEY", undefined);
    assert.equal(resolveSweepExecutor({}, { runDir: other }).skipped, "common-law-no-credential");
    for (const d of [own, other]) rmSync(d, { recursive: true, force: true });
  } finally { pinEnv(process.env, "PERPLEXITY_API_KEY", saved); }
});

test("a route with no web search of its own skips the web half under its own cause, judged on the run's own engine", () => {
  const env = { CLEAROTRON_AI_BILLING: process.env.CLEAROTRON_AI_BILLING, CLAUDE_CODE_USE_BEDROCK: process.env.CLAUDE_CODE_USE_BEDROCK };
  try {
    pinEnv(process.env, "CLEAROTRON_AI_BILLING", "cloud");
    pinEnv(process.env, "CLAUDE_CODE_USE_BEDROCK", "1");
    const runDir = aRun("own", "anthropic-agent");
    const r = resolveSweepExecutor({}, { runDir });
    assert.equal(r.skipped, "own-search-unavailable");
    assert.match(r.why, /Amazon Bedrock/);
    // ITS SENTENCE IS THE OWNER'S TO GIVE, and until it is in the tables the lane stops such a screen before anything is
    // spent rather than deliver it silent about the half it skipped (pipeline-knockout.mjs, after resolveSweepExecutor).
    assert.equal(CAPABILITY_SKIPPED_NOTE["own-search-unavailable"], undefined);
    assert.equal(CAPABILITY_SKIPPED_CAUSE["own-search-unavailable"], undefined);
    rmSync(runDir, { recursive: true, force: true });
  } finally { for (const [k, v] of Object.entries(env)) pinEnv(process.env, k, v); }
});

test("an owner lookup that was never sent is recorded as not run, not as one that did not answer", async () => {
  const runDir = aRun("own");
  try {
    mkdirSync(join(runDir, "research"), { recursive: true });
    const rows = await runOwnerChecks({ owners: [{ mark: "QZORVAK", owner: "Northwind Play GmbH", recordIds: ["r1"], classes: [9] }],
      exec: async () => ({ ok: false, notRun: true, cause: "not run: own search does not run owner lookups yet, and no Perplexity key is set" }), runDir });
    assert.equal(rows[0].ok, false);
    assert.equal(rows[0].notRun, true);
    assert.match(rows[0].cause, /^not run:/);
  } finally { rmSync(runDir, { recursive: true, force: true }); }
});
