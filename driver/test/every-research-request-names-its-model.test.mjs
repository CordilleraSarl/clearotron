// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// EVERY RESEARCH REQUEST NAMES ITS MODEL (providers/perplexity/src/core.js, RESEARCH_MODEL).
//
// Each research effort's default model is the vendor's to move, so the product names the model on every research
// request: questions at each product's pinned effort, the grids, the Knockout's sweep and owner lookups, and the meaning
// re-asks. The effort, tools and search scope stay the request's own. Setup's one-word key check, on `fast`, is left to
// its default, and a model a caller names explicitly wins. Each call's record keeps the model it asked for, the model
// the response names and the effort version that ran it, apart from the preset.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildRequestBody, researchModelFor, RESEARCH_MODEL, servedBy, servedFields } from "../../providers/perplexity/src/core.js";
import { gridProvenanceRecord } from "../engine/mcp/grid-provenance.mjs";
import { runOwnerChecks } from "../owner-use-check.mjs";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("each research effort names the model, and nothing else about the request changes", () => {
  assert.equal(RESEARCH_MODEL, "openai/gpt-6.2-sol");
  for (const preset of ["pro-search", "deep-research", "advanced-deep-research", "low", "medium", "high", "xhigh"]) {
    const named = buildRequestBody({ task: "Who sells QZORVEL candles?", preset, allowFetch: true, domainFilter: ["shop.example.com"] });
    assert.equal(named.model, RESEARCH_MODEL, preset);
    const { model, ...rest } = named;
    const bare = buildRequestBody({ task: "Who sells QZORVEL candles?", preset, allowFetch: true, domainFilter: ["shop.example.com"], modelOverride: "x" });
    delete bare.model;
    assert.deepEqual(rest, bare, `${preset}: only the model was added`);
  }
  const grid = buildRequestBody({ task: "run the grid", preset: "pro-search", enableSandbox: true, reasoning: { effort: "low" } });
  assert.deepEqual({ model: grid.model, preset: grid.preset, tools: grid.tools.map((t) => t.type), reasoning: grid.reasoning },
    { model: RESEARCH_MODEL, preset: "pro-search", tools: ["sandbox", "web_search"], reasoning: { effort: "low" } }, "a grid keeps its effort, tools and reasoning");
});

test("setup's key check keeps its effort's default, and an explicit model wins", () => {
  assert.equal(researchModelFor("fast-search"), null);
  assert.equal(researchModelFor("fast"), null);
  assert.equal("model" in buildRequestBody({ task: "Reply with the single word: ok.", preset: "fast-search" }), false);
  assert.equal(buildRequestBody({ task: "x", preset: "medium", modelOverride: "openai/gpt-6-luna" }).model, "openai/gpt-6-luna");
});

test("what served a call is read from the response, never taken from the request", () => {
  const body = buildRequestBody({ task: "x", preset: "medium" });
  assert.deepEqual(servedBy(body, { model: "openai/gpt-6.2-sol", effort: "medium@2026-10-22.1" }),
    { modelRequested: "openai/gpt-6.2-sol", modelServed: "openai/gpt-6.2-sol", effortServed: "medium@2026-10-22.1" });
  assert.deepEqual(servedBy(body, {}), { modelRequested: "openai/gpt-6.2-sol", modelServed: null, effortServed: null }, "a response that names nothing serves no name");
  assert.deepEqual(servedBy(buildRequestBody({ task: "x", preset: "fast-search" }), { model: "openai/gpt-6-luna" }),
    { modelRequested: null, modelServed: "openai/gpt-6-luna", effortServed: null }, "a request that named no model asked for none");
  assert.deepEqual(servedFields({ ok: true, modelServed: "m" }), { modelServed: "m" }, "only what an executor reported is carried");
  assert.deepEqual(servedFields(null), {});
  assert.deepEqual(Object.fromEntries(["model", "modelServed", "effortServed"].map((k) => [k, gridProvenanceRecord({ ran: true, present: 2, requested: 2, model: RESEARCH_MODEL, modelServed: "openai/gpt-6.2-sol", effortServed: "low@2026-10-24.0" })[k]])),
    { model: RESEARCH_MODEL, modelServed: "openai/gpt-6.2-sol", effortServed: "low@2026-10-24.0" }, "a grid's provenance keeps them beside its preset");
});

test("an owner lookup's row keeps what served it, where the executor reports it", async () => {
  const runDir = mkdtempSync(join(tmpdir(), "served-owner-"));
  try {
    mkdirSync(join(runDir, "research"), { recursive: true });
    const exec = async () => ({ ok: true, text: "Northwind Play GmbH sells wooden toys. https://northwind.test/shop", modelRequested: RESEARCH_MODEL, modelServed: "openai/gpt-6.2-sol", effortServed: "low@2026-10-24.0" });
    const [row] = await runOwnerChecks({ owners: [{ mark: "QZORVEL", owner: "Northwind Play GmbH", recordIds: ["r1"], classes: [28] }], exec, runDir });
    assert.deepEqual({ modelRequested: row.modelRequested, modelServed: row.modelServed, effortServed: row.effortServed, preset: row.preset },
      { modelRequested: RESEARCH_MODEL, modelServed: "openai/gpt-6.2-sol", effortServed: "low@2026-10-24.0", preset: "pro-search" });
  } finally { rmSync(runDir, { recursive: true, force: true }); }
});
